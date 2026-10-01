import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FolderSearch, Import, Minimize2, Maximize, CircleX } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import Logo from './Logo';
import Input from './input';
import Button from './button';
import './header.css';
import SettingsMenu from './settingsMenu';
import FilterMenu from './filterMenu';
import SortMenu from './sortMenu';
import { open } from '@tauri-apps/plugin-dialog';
import {
  loadSearchHistory,
  addSearchItem,
  addTagItem,
  addColorItem,
} from './searchHistory';

export default memo(function Header({
  activeFilter,
  setActiveFilter,
  sortOrder,
  setSortOrder,
  searchQuery,
  setSearchQuery,
  selectedTags,
  setSelectedTags,
  pickerColor,
  setPickerColor,
  selectedColor,
  clearColor,
  dateFilter,
  setDateFilter,
  viewMode,
  setViewMode,
  pillHeader = true,
  onPillHeaderChange,
  themeMode,
  onThemeModeChange,
  rangeVal,
  onRangeValChange,
  autoplay,
  onAutoplayChange,
  thumbnailSize,
  onThumbnailSizeChange,
  disableBlur,
  onDisableBlurChange,
  batchSize,
  onBatchSizeChange,
  gpuAcceleration,
  onGpuAccelerationChange,
  freezeOnMinimize,
  onFreezeOnMinimizeChange,
  setupMode,
  onSetupModeChange,
  localStoragePath,
  onLocalStoragePathChange,
  tagPreviews = [],
}) {
  const headerRef = useRef(null);
  const appWindowRef = useRef(null);
  const [searchHistory, setSearchHistory] = useState({ searches: [], tags: [], colors: [] });

  useEffect(() => {
    appWindowRef.current = getCurrentWindow();
    loadSearchHistory().then((h) => setSearchHistory(h));
  }, []);

  const handleMinimize = useCallback(() => appWindowRef.current?.minimize(), []);
  const handleToggleMaximize = useCallback(() => appWindowRef.current?.toggleMaximize(), []);
  const handleClose = useCallback(() => appWindowRef.current?.close(), []);

  const handleImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        filters: [
          { name: 'All Supported Assets', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'txt', 'md', 'js', 'py', 'rs', 'css', 'html'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
          { name: 'Text & Code', extensions: ['txt', 'md', 'js', 'py', 'rs', 'css', 'html'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      if (!selected) return;
      const rawPaths = Array.isArray(selected) ? selected : [selected];
      const filePaths = rawPaths.map(item =>
        typeof item === 'object' && item !== null && item.path ? item.path : item
      );
      window.dispatchEvent(new CustomEvent('import-files', { detail: { filePaths } }));
    } catch (error) {
      console.error('Import dialog error:', error);
    }
  }, []);

  const handleColorChange = useCallback((color) => {
    setPickerColor(color);
    setSearchHistory((prev) => addColorItem(prev, color));
  }, [setPickerColor]);

  const handleKeyDown = useCallback(async (e) => {
    if (e.key === 'Enter') {
      const trimmed = searchQuery.trim();
      if (trimmed) {
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
          const hex = trimmed.length === 4
            ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
            : trimmed;
          const upperHex = hex.toUpperCase();
          handleColorChange(upperHex);
          setSearchQuery('');
          return;
        }

        const lower = trimmed.toLowerCase();
        const parts = lower.split(/\s+/);
        const lastWord = parts[parts.length - 1];
        if (lastWord) {
          const preview = await invoke('get_search_preview', { query: lastWord }).catch(() => null);
          const tagPreview = tagPreviews?.find(t => t.tag?.toLowerCase() === lastWord.toLowerCase())?.preview_path || preview;
          setSearchHistory((prev) => addTagItem(prev, lastWord, tagPreview));
          if (!selectedTags.includes(lastWord)) {
            setSelectedTags([...selectedTags, lastWord]);
          }
        }
      }
      setSearchQuery('');
      return;
    }
    if (e.key === 'Backspace' && searchQuery === '') {
      if (selectedTags.length > 0) {
        setSelectedTags(selectedTags.slice(0, -1));
      } else if (selectedColor && clearColor) {
        clearColor();
      }
    }
  }, [searchQuery, selectedTags, setSelectedTags, setSearchQuery, selectedColor, clearColor, handleColorChange, tagPreviews]);

  const handleUnfocusSearch = useCallback(async (queryText) => {
    const trimmed = (queryText ?? searchQuery).trim();
    if (trimmed) {
      const preview = await invoke('get_search_preview', { query: trimmed }).catch(() => null);
      setSearchHistory((prev) => addSearchItem(prev, trimmed, preview));
    }
  }, [searchQuery]);

  const removeTag = useCallback((tagToRemove) => {
    setSelectedTags(prev => prev.filter(t => t !== tagToRemove));
  }, [setSelectedTags]);

  const handleSelectRecentSearch = useCallback((text) => {
    setSearchQuery(text);
  }, [setSearchQuery]);

  const handleSelectRecentTag = useCallback((tag) => {
    const normalized = tag.toLowerCase();
    if (!selectedTags.includes(normalized)) {
      setSelectedTags([...selectedTags, normalized]);
    }
  }, [selectedTags, setSelectedTags]);

  const handleSelectRecentColor = useCallback((color) => {
    handleColorChange(color);
  }, [handleColorChange]);

  return (
    <header className={`splatera-header ${!pillHeader ? 'snapped' : ''}`} data-tauri-drag-region ref={headerRef}>
      <div className="splatera-header-card" data-tauri-drag-region>

        {/* Left Section */}
        <div className="header-left-part" data-tauri-drag-region>
          <div className="header-logo" data-tauri-drag-region>
            <Logo size={36} data-tauri-drag-region />
          </div>
          <div className="settings-menu-container">
            <SettingsMenu
              viewMode={viewMode}
              setViewMode={setViewMode}
              pillHeader={pillHeader}
              onPillHeaderChange={onPillHeaderChange}
              themeMode={themeMode}
              onThemeModeChange={onThemeModeChange}
              rangeVal={rangeVal}
              onRangeValChange={onRangeValChange}
              autoplay={autoplay}
              onAutoplayChange={onAutoplayChange}
              thumbnailSize={thumbnailSize}
              onThumbnailSizeChange={onThumbnailSizeChange}
              disableBlur={disableBlur}
              onDisableBlurChange={onDisableBlurChange}
              batchSize={batchSize}
              onBatchSizeChange={onBatchSizeChange}
              gpuAcceleration={gpuAcceleration}
              onGpuAccelerationChange={onGpuAccelerationChange}
              freezeOnMinimize={freezeOnMinimize}
              onFreezeOnMinimizeChange={onFreezeOnMinimizeChange}
              setupMode={setupMode}
              onSetupModeChange={onSetupModeChange}
              localStoragePath={localStoragePath}
              onLocalStoragePathChange={onLocalStoragePathChange}
            />
          </div>
          <div className="import-btn-container">
            <Button
              icon={Import}
              text={<span className="import-text">Import</span>}
              onClick={handleImport}
              className="import-btn"
              tooltip="Import"
              tooltipPosition="bottom"
            />
          </div>
        </div>

        {/* Center Section */}
        <div className="header-center-part" data-tauri-drag-region>
          <div className="search-container">
            <Input
              icon={FolderSearch}
              type="text"
              placeholder="Ponder assets"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              selectedTags={selectedTags}
              onRemoveTag={removeTag}
              selectedColors={selectedColor ? [selectedColor] : []}
              onRemoveColor={clearColor}
              hotkey="S"
              tooltip="Search"
              tooltipPosition="bottom"
              showColorPicker={true}
              pickerColor={pickerColor}
              onPickerColorChange={handleColorChange}
              searchHistory={searchHistory}
              onSelectRecentSearch={handleSelectRecentSearch}
              onSelectRecentTag={handleSelectRecentTag}
              onSelectRecentColor={handleSelectRecentColor}
              onUnfocusSearch={handleUnfocusSearch}
            />
          </div>
        </div>

        {/* Right Section */}
        <div className="header-right-part" data-tauri-drag-region>
          <div className="action-buttons">
            <div className="sort-menu-container">
              <SortMenu sortOrder={sortOrder} setSortOrder={setSortOrder} snapHeader={!pillHeader} />
            </div>
            <div className="filter-menu-container">
              <FilterMenu
                pickerColor={pickerColor}
                setPickerColor={handleColorChange}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                dateFilter={dateFilter}
                setDateFilter={setDateFilter}
                snapHeader={!pillHeader}
              />
            </div>
          </div>

          <div className="window-controls">
            <Button icon={Minimize2} onClick={handleMinimize} className="control-btn" tooltip="Minimize" tooltipPosition="bottom" />
            <Button icon={Maximize} onClick={handleToggleMaximize} className="control-btn" tooltip="Maximize" tooltipPosition="bottom" />
            <Button icon={CircleX} onClick={handleClose} className="control-btn close-btn" tooltip="Close" tooltipPosition="bottom" />
          </div>
        </div>

      </div>
    </header>
  );
});