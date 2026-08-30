import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FolderSearch, Import, Minimize2, Maximize, CircleX } from 'lucide-react';
import Logo from './Logo';
import Input from './input';
import Button from './button';
import './header.css';
import SettingsMenu from './settingsMenu';
import FilterMenu from './filterMenu';
import SortMenu from './sortMenu';
import { open } from '@tauri-apps/plugin-dialog';

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
  snapHeader,
  onSnapHeaderChange,
  themeMode,
  onThemeModeChange,
  rangeVal,
  onRangeValChange,
  autoplay,
  onAutoplayChange,
}) {
  const headerRef = useRef(null);
  const appWindowRef = useRef(null);


  useEffect(() => {
    appWindowRef.current = getCurrentWindow();
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

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const trimmed = searchQuery.trim().toLowerCase();
      if (trimmed) {
        const parts = trimmed.split(/\s+/);
        const lastWord = parts[parts.length - 1];
        if (lastWord && !selectedTags.includes(lastWord)) {
          setSelectedTags([...selectedTags, lastWord]);
        }
      }
      setSearchQuery('');
      return;
    }
    if (e.key === 'Backspace' && searchQuery === '' && selectedTags.length > 0) {
      setSelectedTags(selectedTags.slice(0, -1));
    }
  }, [searchQuery, selectedTags, setSelectedTags, setSearchQuery]);

  const removeTag = useCallback((tagToRemove) => {
    setSelectedTags(prev => prev.filter(t => t !== tagToRemove));
  }, [setSelectedTags]);

  return (
    <header className={`splatera-header ${snapHeader ? 'snapped' : ''}`} data-tauri-drag-region ref={headerRef}>
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
              snapHeader={snapHeader}
              onSnapHeaderChange={onSnapHeaderChange}
              themeMode={themeMode}
              onThemeModeChange={onThemeModeChange}
              rangeVal={rangeVal}
              onRangeValChange={onRangeValChange}
              autoplay={autoplay}
              onAutoplayChange={onAutoplayChange}
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
              onPickerColorChange={setPickerColor}
            />
          </div>
        </div>

        {/* Right Section */}
        <div className="header-right-part" data-tauri-drag-region>
          <div className="action-buttons">
            <div className="sort-menu-container">
              <SortMenu sortOrder={sortOrder} setSortOrder={setSortOrder} snapHeader={snapHeader} />
            </div>
            <div className="filter-menu-container">
              <FilterMenu
                pickerColor={pickerColor}
                setPickerColor={setPickerColor}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                dateFilter={dateFilter}
                setDateFilter={setDateFilter}
                snapHeader={snapHeader}
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