import { Search } from "lucide-react";
import { useCallback, type ChangeEvent } from "react";
import { Input } from "../ui/input.js";
import { Skeleton } from "../ui/skeleton.js";
import { FormField, type FieldControl } from "./form-field.js";

/** A compact search control, with the same field labelling and focus treatment as forms. */
export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder = label,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );
  const render = useCallback(
    (control: FieldControl) => (
      <div className="relative min-w-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          {...control}
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          className="pl-8"
          value={value}
          onChange={change}
          placeholder={placeholder}
        />
      </div>
    ),
    [change, placeholder, value],
  );
  return (
    <FormField id={id} label={label} labelVisibility="hidden">
      {render}
    </FormField>
  );
}

export function SearchFieldSkeleton() {
  return <Skeleton className="h-8 w-72 max-w-full" />;
}
