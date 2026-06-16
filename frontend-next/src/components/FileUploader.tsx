"use client";

import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

import { Button } from "./ui/Button";
import { Checkbox } from "./ui/checkbox";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export default function Page() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);

  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);

  // 1. Parse file only when file changes
  useEffect(() => {
    if (!file) return;

    Papa.parse(file, {
      delimiter: "",
      skipEmptyLines: true,

      complete: (result) => {
        const parsedRows = (result.data as any[]).map((row) =>
          Array.isArray(row) ? row : [String(row)]
        );

        if (!parsedRows.length) return;

        setRawRows(parsedRows);
        setSelectedColumn(0);
      },
    });
  }, [file]);

  // 2. Derive headers + rows whenever raw data or checkbox changes
  useEffect(() => {
    if (!rawRows.length) return;

    const maxCols = Math.max(...rawRows.map((r) => r.length));

    if (hasHeader) {
      setHeaders(
        Array.from(
          { length: maxCols },
          (_, i) => rawRows[0][i] || `Column ${i + 1}`
        )
      );

      setRows(rawRows.slice(1));
    } else {
      setHeaders(
        Array.from(
          { length: maxCols },
          (_, i) => `Column ${i + 1}`
        )
      );

      setRows(rawRows);
    }

    setSelectedColumn(0);
  }, [rawRows, hasHeader]);

  const output = rows
    .map((row) => row[selectedColumn])
    .filter(Boolean);

  return (
    <div className="max-w-xl space-y-6 p-6">
      {/* File input */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => {
          const selectedFile = e.target.files?.[0];
          if (selectedFile) setFile(selectedFile);
        }}
      />

      <Button onClick={() => inputRef.current?.click()}>
        Upload File
      </Button>

      {/* Header toggle */}
      <div className="flex items-center gap-3">
        <Checkbox
          checked={hasHeader}
          onCheckedChange={(checked) =>
            setHasHeader(Boolean(checked))
          }
        />

        <span className="text-sm text-muted-foreground">
          File contains header row
        </span>
      </div>

      {/* Column selector */}
      {headers.length > 1 && (
        <Select
          value={String(selectedColumn)}
          onValueChange={(v) => setSelectedColumn(Number(v))}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {headers.map((header, i) => (
              <SelectItem key={i} value={String(i)}>
                {header}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Output preview */}
      {output.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Preview ({output.length})
          </h3>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="space-y-1 text-sm">
              {output.slice(0, 20).map((item, i) => (
                <div key={i}>{item}</div>
              ))}
            </div>
          </div>

          <pre className="overflow-auto rounded-md border p-3 text-xs">
            {JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}