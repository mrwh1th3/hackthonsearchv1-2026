"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./app-select.module.css";

export interface AppSelectOption { value: string; label: string; disabled?: boolean }
export interface AppSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: AppSelectOption[];
  "aria-label": string;
  "aria-describedby"?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  size?: "sm" | "md";
}

/** A single branded, keyboard-accessible choice menu across the application. */
export function AppSelect({ value, onValueChange, options, placeholder = "Select an option", disabled, className, id, name, size = "md", "aria-label": label, "aria-describedby": describedBy }: AppSelectProps) {
  const selectedLabel = options.find(option => option.value === value)?.label;
  return <Select.Root value={value} onValueChange={onValueChange} disabled={disabled || options.length === 0} name={name}>
    <Select.Trigger id={id} aria-label={label} aria-describedby={describedBy} className={cn(styles.trigger, size === "sm" && styles.small, className)} data-app-select-trigger>
      <Select.Value placeholder={placeholder}>{selectedLabel}</Select.Value>
      <Select.Icon className={styles.icon}><ChevronDown size={14} strokeWidth={1.7} aria-hidden /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className={styles.content} position="popper" sideOffset={6} collisionPadding={12} align="start">
        <Select.ScrollUpButton className={styles.scrollButton}><ChevronUp size={13} aria-hidden /></Select.ScrollUpButton>
        <Select.Viewport className={styles.viewport}>
          {options.map(option => <Select.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.item}>
            <Select.ItemIndicator className={styles.indicator}><Check size={13} strokeWidth={2} aria-hidden /></Select.ItemIndicator>
            <Select.ItemText>{option.label}</Select.ItemText>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className={styles.scrollButton}><ChevronDown size={13} aria-hidden /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
