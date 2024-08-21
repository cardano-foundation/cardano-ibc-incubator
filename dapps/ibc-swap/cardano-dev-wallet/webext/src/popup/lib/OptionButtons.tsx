import { useState } from "preact/hooks";

export interface OptionButtons {
  text?: string;
  backText?: string;
  expanded?: { value: boolean; set: (value: boolean) => void };
  buttons: OptionButton[];
}

export interface OptionButtonSub {
  backText: string;
  buttons: OptionButton[];
}

export interface OptionButton {
  text: string;
  icon?: string;
  secondary?: boolean;
  onClick?: () => void;
  expand?: OptionButtonSub;
}

export function OptionButtons({
  text,
  backText,
  buttons,
  expanded,
}: OptionButtons) {
  if (text == null) text = "Options";
  if (backText == null) backText = text;

  if (!expanded) {
    let [value, set] = useState(false);
    expanded = { value, set };
  }

  let [childExpanded, setChildExpanded] = useState<OptionButtonSub | null>(
    null,
  );

  if (childExpanded == null) {
    let isExpanded = expanded.value;
    let setExpanded = expanded.set;
    let toggleExpanded = () => setExpanded(!isExpanded);

    let expandButton = (
      <button class="button -secondary" onClick={toggleExpanded}>
        {!isExpanded ? text : backText}
        <span
          class={"icon " + (!isExpanded ? "-expand-right" : "-expand-left")}
        />
      </button>
    );
    let subButtons = buttons.map((btn, idx) => {
      let btnClass = "button";
      if (btn.secondary) btnClass += " -secondary";

      let onClick = () => {
        setExpanded(false);
        if (btn.onClick) btn.onClick();
      };

      if (btn.expand != null) {
        let child = btn.expand;
        onClick = () => setChildExpanded(child);
      }

      return (
        <button key={idx} class={btnClass} onClick={onClick}>
          {btn.text} {btn.icon && <span class={"icon -" + btn.icon} />}
        </button>
      );
    });

    return (
      <div class="row gap-m">
        {expandButton}
        {isExpanded && subButtons}
      </div>
    );
  } else
    return (
      <OptionButtons
        backText={childExpanded.backText}
        buttons={childExpanded.buttons}
        expanded={{
          value: true,
          set: (value) => {
            if (!value) {
              setChildExpanded(null)
              expanded?.set(false);
            }
          },
        }}
      />
    );
}
