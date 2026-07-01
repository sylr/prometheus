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

import { EditorState } from '@codemirror/state';
import { SyntaxNode } from '@lezer/common';
import {
  And,
  BinaryExpr,
  MatchingModifierClause,
  LabelName,
  QuotedLabelName,
  EqlSingle,
  GroupingLabels,
  OnGroupingLabels,
  GroupLeft,
  GroupRight,
  On,
  Or,
  Unless,
  NumberDurationLiteral,
  FillModifier,
  FillClause,
  FillLeftClause,
  FillRightClause,
} from '@prometheus-io/lezer-promql';
import { VectorMatchCardinality, VectorMatching } from '../types';
import { containsAtLeastOneChild } from './path-finder';

export function buildVectorMatching(state: EditorState, binaryNode: SyntaxNode): VectorMatching | null {
  if (!binaryNode || binaryNode.type.id !== BinaryExpr) {
    return null;
  }
  const result: VectorMatching = {
    card: VectorMatchCardinality.CardOneToOne,
    matchingLabels: [],
    on: false,
    include: [],
    fill: {
      lhs: null,
      rhs: null,
    },
    matchingLabelMappings: [],
  };
  const modifierClause = binaryNode.getChild(MatchingModifierClause);
  if (modifierClause) {
    result.on = modifierClause.getChild(On) !== null;
    // `on(...)` uses OnGroupingLabels (which may contain renamed pairs);
    // `ignoring(...)` uses GroupingLabels.
    const labelNode =
      modifierClause.getChild(OnGroupingLabels) ?? modifierClause.getChild(GroupingLabels);
    if (labelNode) {
      // Walk the label children in order, pairing `left = right` whenever an
      // EqlSingle (`=`) token appears between two labels.
      let pendingLeft: string | null = null;
      let expectRight = false;
      for (let child = labelNode.firstChild; child !== null; child = child.nextSibling) {
        if (child.type.id === EqlSingle) {
          expectRight = true;
          continue;
        }
        if (child.type.id !== LabelName && child.type.id !== QuotedLabelName) {
          continue; // Parentheses and commas.
        }
        const name = state.sliceDoc(child.from, child.to);
        if (expectRight && pendingLeft !== null) {
          result.matchingLabelMappings.push({ left: pendingLeft, right: name });
          pendingLeft = null;
          expectRight = false;
          continue;
        }
        if (pendingLeft !== null) {
          result.matchingLabels.push(pendingLeft);
        }
        pendingLeft = name;
      }
      if (pendingLeft !== null) {
        result.matchingLabels.push(pendingLeft);
      }
    }

    const groupLeft = modifierClause.getChild(GroupLeft);
    const groupRight = modifierClause.getChild(GroupRight);
    const group = groupLeft || groupRight;
    if (group) {
      result.card = groupLeft ? VectorMatchCardinality.CardManyToOne : VectorMatchCardinality.CardOneToMany;
      const labelNode = group.nextSibling;
      const labels = labelNode?.getChildren(LabelName) || [];
      for (const label of labels) {
        result.include.push(state.sliceDoc(label.from, label.to));
      }
    }
  }

  const fillModifier = binaryNode.getChild(FillModifier);
  if (fillModifier) {
    const fill = fillModifier.getChild(FillClause);
    const fillLeft = fillModifier.getChild(FillLeftClause);
    const fillRight = fillModifier.getChild(FillRightClause);

    const getFillValue = (node: SyntaxNode) => {
      const valueNode = node.getChild(NumberDurationLiteral);
      return valueNode ? parseFloat(state.sliceDoc(valueNode.from, valueNode.to)) : null;
    };

    if (fill) {
      const value = getFillValue(fill);
      result.fill.lhs = value;
      result.fill.rhs = value;
    }

    if (fillLeft) {
      result.fill.lhs = getFillValue(fillLeft);
    }

    if (fillRight) {
      result.fill.rhs = getFillValue(fillRight);
    }
  }

  const isSetOperator = containsAtLeastOneChild(binaryNode, And, Or, Unless);
  if (isSetOperator && result.card === VectorMatchCardinality.CardOneToOne) {
    result.card = VectorMatchCardinality.CardManyToMany;
  }
  return result;
}
