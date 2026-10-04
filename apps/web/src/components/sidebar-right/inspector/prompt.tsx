/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import { PanelSection } from "@/components/ui/panel-section";
import { useDerived, useEditor } from "@/engine/hooks";
import { promptText, setPromptText } from "@/engine/prompt";
import { GrowingTextArea } from "./text";

import type { Entity } from "koota";

type PromptPanelProps = {
  selection: Entity[];
};

export function PromptPanel(props: PromptPanelProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  const prompt = useDerived(() => promptText(entity()));

  return (
    <PanelSection title="Prompt">
      <ControlRow label="Content" class="items-start" labelClass="pt-1 leading-[18px]" contentClass="flex flex-col">
        <GrowingTextArea
          value={prompt()}
          placeholder="Describe what you want to create."
          minRows={2}
          maxRows={8}
          onInput={(value) => setPromptText(editor, entity(), value)}
        />
      </ControlRow>
    </PanelSection>
  );
}
