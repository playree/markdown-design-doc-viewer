import type { Translate } from './l10n';
import type { DiagramKind } from './linker';

/** The texts about the links of a kind of diagram, which name its items: arrows, nodes, entities or states. */
export interface DiagramWording {
  refWithoutMarker: string;
  markerNotTopLevel: string;
  refNotFound: (heading: string) => string;
  /** Tooltip of a step heading no item is linked to. */
  unlinkedHeadingTitle: string;
  /** Mark of a step heading no item is linked to. */
  unlinkedHeadingMark: string;
  nothingLinked: string;
  unlinkedItem: (label: string) => string;
  unlinkedHeading: (heading: string) => string;
  /** Quick fix of a step heading no item is linked to. */
  linkItemFix: (label: string) => string;
  /** Completion details of the headings of `%% @ref`. */
  linkedCandidate: string;
  unlinkedCandidate: string;
  /** Completion documentation of the directives. */
  markerDoc: string;
  refDoc: string;
}

export function diagramWording(kind: DiagramKind, t: Translate): DiagramWording {
  switch (kind) {
    case 'sequence':
      return {
        refWithoutMarker: t('@ref is ignored because the sequence diagram has no "%% @link-headings" marker.'),
        markerNotTopLevel: t('@link-headings is ignored for a sequence diagram inside a list or blockquote.'),
        refNotFound: (heading) => t('@ref target heading "{0}" was not found after the sequence diagram.', heading),
        unlinkedHeadingTitle: t('No arrow in the sequence diagram is linked to this heading.'),
        unlinkedHeadingMark: t('no arrow'),
        nothingLinked: t('No arrow in the sequence diagram is linked to a heading. Write the steps as headings after the diagram, with the same text as the arrows.'),
        unlinkedItem: (label) =>
          t('Arrow "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the arrow.', label),
        unlinkedHeading: (heading) => t('No arrow in the sequence diagram is linked to heading "{0}".', heading),
        linkItemFix: (label) => t('Link arrow "{0}" to this heading with @ref', label),
        linkedCandidate: t('Already linked to an arrow'),
        unlinkedCandidate: t('No arrow linked yet'),
        markerDoc: t('Show this sequence diagram side by side with the step headings after it.'),
        refDoc: t('Link the next arrow to a heading.'),
      };
    case 'flowchart':
      return {
        refWithoutMarker: t('@ref is ignored because the flowchart has no "%% @link-headings" marker.'),
        markerNotTopLevel: t('@link-headings is ignored for a flowchart inside a list or blockquote.'),
        refNotFound: (heading) => t('@ref target heading "{0}" was not found after the flowchart.', heading),
        unlinkedHeadingTitle: t('No node in the flowchart is linked to this heading.'),
        unlinkedHeadingMark: t('no node'),
        nothingLinked: t('No node in the flowchart is linked to a heading. Write the steps as headings after the diagram, with the same text as the nodes.'),
        unlinkedItem: (label) =>
          t('Node "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the node.', label),
        unlinkedHeading: (heading) => t('No node in the flowchart is linked to heading "{0}".', heading),
        linkItemFix: (label) => t('Link node "{0}" to this heading with @ref', label),
        linkedCandidate: t('Already linked to a node'),
        unlinkedCandidate: t('No node linked yet'),
        markerDoc: t('Show this flowchart with the step headings after it and link its nodes to them (side by side, or below a horizontal flowchart).'),
        refDoc: t('Link the node defined on the next line to a heading.'),
      };
    case 'er':
      return {
        refWithoutMarker: t('@ref is ignored because the ER diagram has no "%% @link-headings" marker.'),
        markerNotTopLevel: t('@link-headings is ignored for an ER diagram inside a list or blockquote.'),
        refNotFound: (heading) => t('@ref target heading "{0}" was not found after the ER diagram.', heading),
        unlinkedHeadingTitle: t('No entity in the ER diagram is linked to this heading.'),
        unlinkedHeadingMark: t('no entity'),
        nothingLinked: t('No entity in the ER diagram is linked to a heading. Write a heading for each entity after the diagram, with the same text as the entity.'),
        unlinkedItem: (label) =>
          t('Entity "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the entity.', label),
        unlinkedHeading: (heading) => t('No entity in the ER diagram is linked to heading "{0}".', heading),
        linkItemFix: (label) => t('Link entity "{0}" to this heading with @ref', label),
        linkedCandidate: t('Already linked to an entity'),
        unlinkedCandidate: t('No entity linked yet'),
        markerDoc: t('Show this ER diagram with the headings after it and link its entities to them (side by side, or below a horizontal diagram).'),
        refDoc: t('Link the entity defined on the next line to a heading.'),
      };
    case 'state':
      return {
        refWithoutMarker: t('@ref is ignored because the state diagram has no "%% @link-headings" marker.'),
        markerNotTopLevel: t('@link-headings is ignored for a state diagram inside a list or blockquote.'),
        refNotFound: (heading) => t('@ref target heading "{0}" was not found after the state diagram.', heading),
        unlinkedHeadingTitle: t('No state in the state diagram is linked to this heading.'),
        unlinkedHeadingMark: t('no state'),
        nothingLinked: t('No state in the state diagram is linked to a heading. Write a heading for each state after the diagram, with the same text as the state.'),
        unlinkedItem: (label) =>
          t('State "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the state.', label),
        unlinkedHeading: (heading) => t('No state in the state diagram is linked to heading "{0}".', heading),
        linkItemFix: (label) => t('Link state "{0}" to this heading with @ref', label),
        linkedCandidate: t('Already linked to a state'),
        unlinkedCandidate: t('No state linked yet'),
        markerDoc: t('Show this state diagram with the headings after it and link its states to them (side by side, or below a horizontal diagram).'),
        refDoc: t('Link the state defined on the next line to a heading.'),
      };
  }
}
