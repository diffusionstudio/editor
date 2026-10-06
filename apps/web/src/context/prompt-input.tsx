/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createSignal, useContext } from "solid-js";
import type { JSX } from "solid-js";
import type { GenerationConfig } from "@/components/genai/types";

type PromptInputContextValue = {
  openPromptInput: (config: GenerationConfig) => void;
  promptInputOpen: () => boolean;
  setPromptInputOpen: (open: boolean) => void;
  promptInputConfig: () => GenerationConfig | undefined;
};

const PromptInputContext = createContext<PromptInputContextValue>();

export function PromptInputProvider(props: { children: JSX.Element }) {
  const [promptInputOpen, setPromptInputOpen] = createSignal(false);
  const [promptInputConfig, setPromptInputConfig] = createSignal<GenerationConfig | undefined>();

  const openPromptInput = (config: GenerationConfig) => {
    setPromptInputConfig(config);
    setPromptInputOpen(true);
  };

  return (
    <PromptInputContext.Provider value={{ openPromptInput, promptInputOpen, promptInputConfig, setPromptInputOpen }}>
      {props.children}
    </PromptInputContext.Provider>
  );
}

export function usePromptInput() {
  const context = useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInputProvider");
  return context;
}
