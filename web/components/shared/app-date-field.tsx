"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import styles from "./app-date-field.module.css";

export interface AppDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  /** Initial calendar day when empty; ISO wall date, independent of timezone conversion. */
  referenceDate?: string;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function toISO(date: Date): string { return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`; }

/** Validate real calendar dates; Date alone silently normalizes February 30. */
export function isISODate(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value.slice(0, 4) !== "0000" && toISO(parseDate(value)) === value;
}

function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toISO(date);
}

function moveMonth(value: string, amount: number): string {
  const date = parseDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return toISO(date);
}

const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Manual ISO input and a small, keyboard-operated calendar share the same date contract. */
export function AppDateField({ value, onChange, label, id, min, max, disabled, className, referenceDate }: AppDateFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const earliest = min && isISODate(min) ? min : "0001-01-01";
  const latest = max && isISODate(max) ? max : "9999-12-31";
  const now = new Date();
  const today = `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
  const clamp = (date: string) => parseDate(date) < parseDate(earliest) ? earliest : parseDate(date) > parseDate(latest) ? latest : date;
  const initialDay = clamp(isISODate(value) ? value : referenceDate && isISODate(referenceDate) ? referenceDate : today);
  const [open, setOpen] = useState(false);
  const [focusedDay, setFocusedDay] = useState(initialDay);
  const [visibleMonth, setVisibleMonth] = useState(initialDay.slice(0, 7));
  // A partial edit stays visible while the caller receives an empty, non-applicable value.
  const [draft, setDraft] = useState({ emitted: value, text: value });
  const [touched, setTouched] = useState(false);
  const text = draft.emitted === value ? draft.text : value;
  const valid = (candidate: string) => isISODate(candidate) && candidate >= earliest && candidate <= latest;
  const invalid = text !== "" && !valid(text);
  const calendar = useRef<HTMLDivElement>(null);
  const shouldFocusDay = useRef(false);
  const first = `${visibleMonth}-01`;
  const gridStart = addDays(first, -parseDate(first).getUTCDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const previousMonth = moveMonth(first, -1);
  const nextMonth = moveMonth(first, 1);
  const canPrevious = first > earliest && first > "0001-01-01";
  const canNext = nextMonth <= latest && first < "9999-12-01";

  useEffect(() => {
    if (open && shouldFocusDay.current) {
      calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus();
      shouldFocusDay.current = false;
    }
  }, [open, focusedDay, visibleMonth]);

  function changeOpen(next: boolean) {
    if (next) {
      const anchor = clamp(valid(value) ? value : initialDay);
      setFocusedDay(anchor);
      setVisibleMonth(anchor.slice(0, 7));
      shouldFocusDay.current = true;
    }
    setOpen(next);
  }

  function selectDate(next: string) {
    setDraft({ emitted: next, text: next });
    setTouched(false);
    onChange(next);
    setOpen(false);
  }

  function navigateTo(next: string, focus = true) {
    const day = clamp(next);
    shouldFocusDay.current = focus;
    setFocusedDay(day);
    setVisibleMonth(day.slice(0, 7));
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let next: string | undefined;
    const weekday = parseDate(day).getUTCDay();
    switch (event.key) {
      case "ArrowLeft": next = addDays(day, -1); break;
      case "ArrowRight": next = addDays(day, 1); break;
      case "ArrowUp": next = addDays(day, -7); break;
      case "ArrowDown": next = addDays(day, 7); break;
      case "Home": next = addDays(day, -weekday); break;
      case "End": next = addDays(day, 6 - weekday); break;
      case "PageUp": next = moveMonth(day, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = moveMonth(day, event.shiftKey ? 12 : 1); break;
    }
    if (next) { event.preventDefault(); navigateTo(next); }
  }

  return <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
    <div className={cn(styles.field, className)}>
      <Popover.Anchor asChild>
        <div className={styles.control} data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
          <input id={inputId} aria-label={label} type="text" placeholder="YYYY-MM-DD" autoComplete="off" spellCheck={false} maxLength={10} value={text} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={invalid && (touched || text.length === 10) ? `${inputId}-error` : undefined}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); changeOpen(true); } }}
            onChange={(event) => {
              const next = event.target.value;
              const emitted = valid(next) ? next : "";
              setDraft({ emitted, text: next });
              onChange(emitted);
            }}/>
          <Popover.Trigger asChild><button type="button" disabled={disabled} aria-label={`Open calendar for ${label}`} title={`Open calendar for ${label}`} className={styles.trigger}><CalendarDays size={15} strokeWidth={1.6} aria-hidden /></button></Popover.Trigger>
        </div>
      </Popover.Anchor>
      {invalid && (touched || text.length === 10) && <span id={`${inputId}-error`} className={styles.error}>
        {!isISODate(text) ? "Use a valid date: YYYY-MM-DD." : `Choose ${min ? `on or after ${min}` : "a date"}${min && max ? " and " : " "}${max ? `on or before ${max}` : ""}.`}
      </span>}
    </div>
    <Popover.Portal>
      <Popover.Content ref={calendar} aria-label={`${label} calendar`} className={styles.calendar} sideOffset={7} collisionPadding={12} align="start"
        onOpenAutoFocus={(event) => { event.preventDefault(); calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus(); }}>
        <div className={styles.header}>
          <button type="button" aria-label="Previous month" className={styles.nav} disabled={!canPrevious} onClick={() => navigateTo(clamp(previousMonth), false)}><ChevronLeft size={16} aria-hidden /></button>
          <span className={styles.month} aria-live="polite">{monthLabel.format(parseDate(first))}</span>
          <button type="button" aria-label="Next month" className={styles.nav} disabled={!canNext} onClick={() => navigateTo(clamp(nextMonth), false)}><ChevronRight size={16} aria-hidden /></button>
        </div>
        <div role="grid" aria-label={`Choose ${label}`} className={styles.grid}>
          <div role="row" className={styles.week}>
            {weekdays.map(day => <span key={day} role="columnheader" aria-label={day} className={styles.weekday}>{day.slice(0, 2)}</span>)}
          </div>
          {Array.from({ length: 6 }, (_, week) => <div role="row" className={styles.week} key={week}>
            {days.slice(week * 7, week * 7 + 7).map(day => <div role="gridcell" key={day}>
              <button type="button" data-date={day} data-outside={day.slice(0, 7) !== visibleMonth || undefined} className={styles.day} aria-label={longDate.format(parseDate(day))}
                aria-pressed={day === value} aria-current={day === today ? "date" : undefined} tabIndex={day === focusedDay ? 0 : -1} disabled={!valid(day)}
                onFocus={() => setFocusedDay(day)} onKeyDown={(event) => onDayKeyDown(event, day)} onClick={() => selectDate(day)}>{parseDate(day).getUTCDate()}</button>
            </div>)}
          </div>)}
        </div>
        <div className={styles.footer}><span>Arrow keys to move · Enter to select</span><button type="button" aria-label={`Clear ${label}`} disabled={!text} onClick={() => selectDate("")}>Clear</button></div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
