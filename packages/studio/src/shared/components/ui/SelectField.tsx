/**
 * 统一下拉框组件（自绘面板）。
 * 自定义面板是为避免原生 select 样式跨平台差异，并放大右侧点击区域；
 * 支持点击外部 / Esc 关闭，disabled 时强制收起。
 */
import { useEffect, useId, useRef, useState } from "react";

/** 下拉选项：description 作为选项下的辅助说明，disabled 表示不可选。 */
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

  // 变为禁用时同步收起面板，避免禁用状态下残留打开的菜单。
  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  // 面板打开期间挂载全局事件：点击组件外部或按 Esc 即关闭，卸载时清理监听。
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

  /** 选中选项：禁用项直接忽略，选中后立即关闭面板并把值交给父级。 */
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
