import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * 统一下拉框组件。
 *
 * 使用自定义面板是为了避免不同系统原生 select 样式差异过大，
 * 也让右侧下拉按钮区域更大、更容易点击。
 */
export function SelectField({ value, options, placeholder = "请选择", disabled = false, onChange }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function chooseOption(option: SelectOption) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
  }

  return (
    <div className={`select-field${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={rootRef}>
      <button
        aria-controls={fieldId}
        aria-expanded={open}
        className="select-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className={selectedOption ? "select-value" : "select-placeholder"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="select-trigger-icon" aria-hidden="true">
          <span />
        </span>
      </button>

      {open ? (
        <div className="select-menu" id={fieldId} role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={`select-option${option.value === value ? " selected" : ""}`}
              disabled={option.disabled}
              key={option.value}
              role="option"
              type="button"
              onClick={() => chooseOption(option)}
            >
              <span>{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
