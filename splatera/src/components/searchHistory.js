import { invoke } from '@tauri-apps/api/core';

const MAX_ITEMS = 15;

export async function loadSearchHistory() {
  try {
    const raw = await invoke('load_search_history');
    const parsed = JSON.parse(raw);
    return {
      searches: Array.isArray(parsed.searches) ? parsed.searches : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
    };
  } catch (err) {
    console.error('Failed to load search history:', err);
    return { searches: [], tags: [], colors: [] };
  }
}

export async function saveSearchHistory(history) {
  try {
    await invoke('save_search_history', { history: JSON.stringify(history) });
  } catch (err) {
    console.error('Failed to save search history:', err);
  }
}

export function addSearchItem(prevHistory, text, previewPath) {
  if (!text || !text.trim()) return prevHistory;
  const trimmed = text.trim();
  const filtered = prevHistory.searches.filter(
    (s) => s.text.toLowerCase() !== trimmed.toLowerCase()
  );
  const updatedSearches = [{ text: trimmed, previewPath }, ...filtered].slice(0, MAX_ITEMS);
  const nextHistory = { ...prevHistory, searches: updatedSearches };
  saveSearchHistory(nextHistory);
  return nextHistory;
}

export function addTagItem(prevHistory, tag, previewPath) {
  if (!tag || !tag.trim()) return prevHistory;
  const trimmed = tag.trim();
  const filtered = prevHistory.tags.filter(
    (t) => t.tag.toLowerCase() !== trimmed.toLowerCase()
  );
  const updatedTags = [{ tag: trimmed, previewPath }, ...filtered].slice(0, MAX_ITEMS);
  const nextHistory = { ...prevHistory, tags: updatedTags };
  saveSearchHistory(nextHistory);
  return nextHistory;
}

export function addColorItem(prevHistory, color) {
  if (!color || !color.trim()) return prevHistory;
  const trimmed = color.trim().toUpperCase();
  const filtered = prevHistory.colors.filter(
    (c) => c.color.toUpperCase() !== trimmed
  );
  const updatedColors = [{ color: trimmed }, ...filtered].slice(0, MAX_ITEMS);
  const nextHistory = { ...prevHistory, colors: updatedColors };
  saveSearchHistory(nextHistory);
  return nextHistory;
}
