// Copyright 2017 The Prometheus Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package remote

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/go-kit/kit/log"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/v2/config"
	"github.com/prometheus/prometheus/v2/pkg/labels"
	"github.com/prometheus/prometheus/v2/pkg/logging"
	"github.com/prometheus/prometheus/v2/storage"
)

// String constants for instrumentation.
const (
	namespace  = "prometheus"
	subsystem  = "remote_storage"
	remoteName = "remote_name"
	endpoint   = "url"
)

// startTimeCallback is a callback func that return the oldest timestamp stored in a storage.
type startTimeCallback func() (int64, error)

// Storage represents all the remote read and write endpoints.  It implements
// storage.Storage.
type Storage struct {
	logger log.Logger
	mtx    sync.Mutex

	rws *WriteStorage

	// For reads
	queryables             []storage.Queryable
	localStartTimeCallback startTimeCallback
}

// NewStorage returns a remote.Storage.
func NewStorage(l log.Logger, reg prometheus.Registerer, stCallback startTimeCallback, walDir string, flushDeadline time.Duration) *Storage {
	if l == nil {
		l = log.NewNopLogger()
	}
	s := &Storage{
		logger:                 logging.Dedupe(l, 1*time.Minute),
		localStartTimeCallback: stCallback,
	}
	s.rws = NewWriteStorage(s.logger, reg, walDir, flushDeadline)
	return s
}

// ApplyConfig updates the state as the new config requires.
func (s *Storage) ApplyConfig(conf *config.Config) error {
	s.mtx.Lock()
	defer s.mtx.Unlock()

	if err := s.rws.ApplyConfig(conf); err != nil {
		return err
	}

	// Update read clients
	readHashes := make(map[string]struct{})
	queryables := make([]storage.Queryable, 0, len(conf.RemoteReadConfigs))
	for _, rrConf := range conf.RemoteReadConfigs {
		hash, err := toHash(rrConf)
		if err != nil {
			return err
		}

		// Don't allow duplicate remote read configs.
		if _, ok := readHashes[hash]; ok {
			return fmt.Errorf("duplicate remote read configs are not allowed, found duplicate for URL: %s", rrConf.URL)
		}
		readHashes[hash] = struct{}{}

		// Set the queue name to the config hash if the user has not set
		// a name in their remote write config so we can still differentiate
		// between queues that have the same remote write endpoint.
		name := string(hash[:6])
		if rrConf.Name != "" {
			name = rrConf.Name
		}

		c, err := NewClient(name, &ClientConfig{
			URL:              rrConf.URL,
			Timeout:          rrConf.RemoteTimeout,
			HTTPClientConfig: rrConf.HTTPClientConfig,
		})
		if err != nil {
			return err
		}

		q := QueryableClient(c)
		q = ExternalLabelsHandler(q, conf.GlobalConfig.ExternalLabels)
		if len(rrConf.RequiredMatchers) > 0 {
			q = RequiredMatchersFilter(q, labelsToEqualityMatchers(rrConf.RequiredMatchers))
		}
		if !rrConf.ReadRecent {
			q = PreferLocalStorageFilter(q, s.localStartTimeCallback)
		}
		queryables = append(queryables, q)
	}
	s.queryables = queryables

	return nil
}

// StartTime implements the Storage interface.
func (s *Storage) StartTime() (int64, error) {
	return int64(model.Latest), nil
}

// Querier returns a storage.MergeQuerier combining the remote client queriers
// of each configured remote read endpoint.
func (s *Storage) Querier(ctx context.Context, mint, maxt int64) (storage.Querier, error) {
	s.mtx.Lock()
	queryables := s.queryables
	s.mtx.Unlock()

	queriers := make([]storage.Querier, 0, len(queryables))
	for _, queryable := range queryables {
		q, err := queryable.Querier(ctx, mint, maxt)
		if err != nil {
			return nil, err
		}
		queriers = append(queriers, q)
	}
	return storage.NewMergeQuerier(nil, queriers), nil
}

// Appender implements storage.Storage.
func (s *Storage) Appender() (storage.Appender, error) {
	return s.rws.Appender()
}

// Close the background processing of the storage queues.
func (s *Storage) Close() error {
	s.mtx.Lock()
	defer s.mtx.Unlock()
	return s.rws.Close()
}

func labelsToEqualityMatchers(ls model.LabelSet) []*labels.Matcher {
	ms := make([]*labels.Matcher, 0, len(ls))
	for k, v := range ls {
		ms = append(ms, &labels.Matcher{
			Type:  labels.MatchEqual,
			Name:  string(k),
			Value: string(v),
		})
	}
	return ms
}

// Used for hashing configs and diff'ing hashes in ApplyConfig.
func toHash(data interface{}) (string, error) {
	bytes, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	hash := md5.Sum(bytes)
	return hex.EncodeToString(hash[:]), nil
}
