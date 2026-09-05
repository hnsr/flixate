import { useState } from "react";
import { normalizeFilterSettings } from "../domain/backup.js";
import type { FilterSettings } from "../domain/catalog.js";
import { usePersistentState } from "../hooks/use-persistent-state.js";

type Preset = { id: string; name: string; settings: FilterSettings };

function parsePresets(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => item && typeof item === "object"
    && typeof item.id === "string" && typeof item.name === "string" && item.name.trim()
    ? [{ id: item.id, name: item.name.slice(0, 80), settings: normalizeFilterSettings(item.settings) }]
    : []);
}

export function FilterPresets(props: { getSettings: () => FilterSettings; onApply: (settings: FilterSettings) => void }): React.JSX.Element {
  const [presets, setPresets] = usePersistentState<Preset[]>("flixate:presets:v1", [], parsePresets);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  return (
    <details className="filter-presets">
      <summary>Saved filters{presets.length ? ` · ${presets.length}` : ""}</summary>
      <div className="preset-body">
        {presets.length > 0 && (
          <div className="preset-row">
            <label>Apply saved filters
              <select value={selected} onChange={event => {
                setSelected(event.target.value);
                const preset = presets.find(item => item.id === event.target.value);
                if (preset) props.onApply(preset.settings);
              }}>
                <option value="">Choose a preset</option>
                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
            <button type="button" className="secondary-button" disabled={!selected} onClick={() => {
              const preset = presets.find(item => item.id === selected);
              if (preset) props.onApply(preset.settings);
            }}>Apply preset</button>
            <button type="button" className="text-button" disabled={!selected} onClick={() => {
              setPresets(presets.filter(item => item.id !== selected)); setSelected("");
            }}>Delete preset</button>
          </div>
        )}
        <form onSubmit={event => {
          event.preventDefault();
          if (!name.trim()) return;
          setPresets([...presets, { id: crypto.randomUUID(), name: name.trim(), settings: props.getSettings() }]);
          setName(""); setSelected("");
        }}>
          <label>Preset name
            <input value={name} onChange={event => setName(event.target.value)}
              maxLength={80} placeholder="e.g. Highly rated sci-fi" required />
          </label>
          <button className="secondary-button" disabled={!name.trim()}>Save current filters</button>
        </form>
        <p className="field-note">Presets remember search, filters, and sort in this browser.</p>
      </div>
    </details>
  );
}
