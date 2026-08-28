/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

import type { SceneNode as AuthoredSceneNode } from '@diffusionstudio/jsx';

/** The real DOM node owned by a scene node. */
export type DomNode = Element | Text;

/**
 * One element of the document, and its place in it: the authoring `SceneNode`
 * (see @diffusionstudio/jsx) instantiated with the DOM node type the document
 * manages. `parent` and `children` are the tree the reconciler reads back:
 * text nodes and element nodes in the one order they were inserted in, which
 * is what the document answers `getFirstChild` and `getNextSibling` from.
 */
export type SceneNode = AuthoredSceneNode<DomNode>;

// The document node an entity was rendered from, on the entity itself: the
// one object the document and the renderer both hold for it, so `===` between
// two of them means what it says. AoS storage like the other handle traits —
// entity.get(Host) returns the node — and never serialized: a node is this
// render's business, rebuilt whenever a document renders the entity again.
export const Host = trait(() => null as SceneNode | null);
