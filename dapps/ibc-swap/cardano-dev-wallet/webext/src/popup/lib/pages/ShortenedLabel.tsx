import { useState } from "preact/hooks";
import { ellipsizeMiddle } from "../utils";

export interface ShortenedLabelProps {
  classes: string;
  text: string;
  prefixLen: number;
  suffixLen: number;
}

export function ShortenedLabel({
  classes,
  text,
  prefixLen,
  suffixLen,
}: ShortenedLabelProps) {
  const onCopy = () => {
    setCopyBtn("copied");
    navigator.clipboard.writeText(text);
    setTimeout(() => {
      setCopyBtn("copy")
    }, 1000);
  };

  let [copyBtn, setCopyBtn] = useState("copy");

  let textShrunk = ellipsizeMiddle(text, prefixLen, suffixLen);
  return (
    <div class={classes + " row align-end auto-hide-parent"}>
      {textShrunk}
      <button class="button auto-hide" onClick={onCopy}>
        <span class="icon -copy"></span>
        {copyBtn}
      </button>
    </div>
  );
}
