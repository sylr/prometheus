// Copyright 2021 The Prometheus Authors
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

import { buildVectorMatching } from './vector';
import { createEditorState } from '../test/utils-test';
import { BinaryExpr } from '@prometheus-io/lezer-promql';
import { syntaxTree } from '@codemirror/language';
import { VectorMatchCardinality, VectorMatching } from '../types';

const noFill = { fill: { lhs: null, rhs: null } };

describe('buildVectorMatching test', () => {
  const testCases: { binaryExpr: string; expectedVectorMatching: VectorMatching }[] = [
    {
      binaryExpr: 'foo * bar',
      expectedVectorMatching: { card: VectorMatchCardinality.CardOneToOne, matchingLabels: [], on: false, include: [], ...noFill, matchingLabelMappings: [] },
    },
    {
      binaryExpr: 'foo * sum',
      expectedVectorMatching: { card: VectorMatchCardinality.CardOneToOne, matchingLabels: [], on: false, include: [], ...noFill, matchingLabelMappings: [] },
    },
    {
      binaryExpr: 'foo == 1',
      expectedVectorMatching: { card: VectorMatchCardinality.CardOneToOne, matchingLabels: [], on: false, include: [], ...noFill, matchingLabelMappings: [] },
    },
    {
      binaryExpr: 'foo == bool 1',
      expectedVectorMatching: { card: VectorMatchCardinality.CardOneToOne, matchingLabels: [], on: false, include: [], ...noFill, matchingLabelMappings: [] },
    },
    {
      binaryExpr: '2.5 / bar',
      expectedVectorMatching: { card: VectorMatchCardinality.CardOneToOne, matchingLabels: [], on: false, include: [], ...noFill, matchingLabelMappings: [] },
    },
    {
      binaryExpr: 'foo and bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo or bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo unless bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      // Test and/or precedence and reassigning of operands.
      // Here it will test only the first VectorMatching so (a + b) or (c and d) ==> ManyToMany
      binaryExpr: 'foo + bar or bla and blub',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      // Test and/or/unless precedence.
      // Here it will test only the first VectorMatching so ((a and b) unless c) or d ==> ManyToMany
      binaryExpr: 'foo and bar unless baz or qux',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo * on(test,blub) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: ['test', 'blub'],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo * on(test,blub) group_left bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToOne,
        matchingLabels: ['test', 'blub'],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo and on(test,blub) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: ['test', 'blub'],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo and on() bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo and ignoring(test,blub) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: ['test', 'blub'],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo and ignoring() bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: false,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo unless on(bar) baz',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: ['bar'],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo / on(test,blub) group_left(bar) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToOne,
        matchingLabels: ['test', 'blub'],
        on: true,
        include: ['bar'],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo / ignoring(test,blub) group_left(blub) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToOne,
        matchingLabels: ['test', 'blub'],
        on: false,
        include: ['blub'],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo / ignoring(test,blub) group_left(bar) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToOne,
        matchingLabels: ['test', 'blub'],
        on: false,
        include: ['bar'],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo - on(test,blub) group_right(bar,foo) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToMany,
        matchingLabels: ['test', 'blub'],
        on: true,
        include: ['bar', 'foo'],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo - ignoring(test,blub) group_right(bar,foo) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToMany,
        matchingLabels: ['test', 'blub'],
        on: false,
        include: ['bar', 'foo'],
        ...noFill,
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo + fill(23) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: [],
        on: false,
        include: [],
        fill: { lhs: 23, rhs: 23 },
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo + fill_left(23) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: [],
        on: false,
        include: [],
        fill: { lhs: 23, rhs: null },
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo + fill_right(23) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: [],
        on: false,
        include: [],
        fill: { lhs: null, rhs: 23 },
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo + fill_left(23) fill_right(42) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: [],
        on: false,
        include: [],
        fill: { lhs: 23, rhs: 42 },
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo + fill_right(23) fill_left(42) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardOneToOne,
        matchingLabels: [],
        on: false,
        include: [],
        fill: { lhs: 42, rhs: 23 },
        matchingLabelMappings: [],
      },
    },
    {
      binaryExpr: 'foo and on(pod = pod_name) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToMany,
        matchingLabels: [],
        on: true,
        include: [],
        ...noFill,
        matchingLabelMappings: [{ left: 'pod', right: 'pod_name' }],
      },
    },
    {
      binaryExpr: 'foo * on(instance, pod = pod_name) group_left(x) bar',
      expectedVectorMatching: {
        card: VectorMatchCardinality.CardManyToOne,
        matchingLabels: ['instance'],
        on: true,
        include: ['x'],
        ...noFill,
        matchingLabelMappings: [{ left: 'pod', right: 'pod_name' }],
      },
    },
  ];
  testCases.forEach((value) => {
    it(value.binaryExpr, () => {
      const state = createEditorState(value.binaryExpr);
      const node = syntaxTree(state).topNode.getChild(BinaryExpr);
      expect(node).toBeTruthy();
      if (node) {
        expect(buildVectorMatching(state, node)).toEqual(value.expectedVectorMatching);
      }
    });
  });
});
