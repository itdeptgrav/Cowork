"use client";

/**
 * One settings rule as a labelled set of choices.
 *
 * **Choices, not a switch.** Every rule here has two named options where neither
 * is "off" — "block submission" and "warn and allow" are both behaviours, and a
 * toggle would force one of them to be the unlabelled state. A person reading a
 * toggle has to infer what the other position does; reading two labels, they
 * don't.
 *
 * Each option carries its own consequence in a hint, and the current default is
 * marked as today's behaviour where that is true. An administrator changing a
 * rule needs to know what it is changing *from*, and "today's behaviour" is a
 * more useful fact than "default" — it says the product is doing this right now.
 */
export function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { id: T; label: string; hint: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="px-4 py-3">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {hint && (
        <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-ink-faint">
          {hint}
        </p>
      )}
      <div className="mt-2.5 flex flex-col gap-2">
        {options.map((option) => {
          const on = option.id === value;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-inset px-2.5 py-2 transition-colors ${
                on ? "bg-[var(--surface-sunken)]" : "hover:bg-[var(--row-hover)]"
              } ${disabled ? "cursor-default opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={label}
                checked={on}
                disabled={disabled}
                onChange={() => onChange(option.id)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-ink">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
