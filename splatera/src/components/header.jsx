import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FolderSearch, Import, Minimize2, Maximize, CircleX } from 'lucide-react';
import Logo from './Logo';
import Input from './input';
import ColorPicker from './colorPicker';
import Button from './button';
import Label from './label';
import './header.css';
import SettingsMenu from './settingsMenu';
import FilterMenu from './filterMenu';
import SortMenu from './sortMenu';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

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
}) {
  const headerRef = useRef(null);
  // FIX: Acquire the window handle once in a ref, not on every render call.
  // Previously `getCurrentWindow()` was called at the top of the component body,
  // meaning it ran on every re-render (which happens on every resize pixel change).
  const appWindowRef = useRef(null);
  useEffect(() => {
    appWindowRef.current = getCurrentWindow();
  }, []);

  // FIX: Stable, memoized window control handlers.
  // Previously these were inline arrows `() => appWindow.minimize()` which
  // recreated a new function reference on every render, causing Button to
  // re-render and briefly lose its active state during rapid resize.
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
      console.error("Import dialog error:", error);
    }
  }, []);

  useEffect(() => {
    if (!headerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const headerHeight = entry.borderBoxSize[0].blockSize;
      document.documentElement.style.setProperty('--scrollbar-margin', `${headerHeight + 10}px`);
    });
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const trimmed = searchQuery.trim().toLowerCase();
      if (trimmed && !selectedTags.includes(trimmed)) {
        setSelectedTags([...selectedTags, trimmed]);
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

  // FIX: Memoized filter toggle handlers — one per tag, stable references.
  // Previously each render created new inline `() => setActiveFilter(...)` arrows,
  // causing Label flicker during resize as React diffed them as changed props.
  const togglePng = useCallback(() => setActiveFilter(f => f === 'png' ? null : 'png'), [setActiveFilter]);
  const toggleSvg = useCallback(() => setActiveFilter(f => f === 'svg' ? null : 'svg'), [setActiveFilter]);
  const toggleTxt = useCallback(() => setActiveFilter(f => f === 'txt' ? null : 'txt'), [setActiveFilter]);
  const toggleImages = useCallback(() => setActiveFilter(f => f === 'images' ? null : 'images'), [setActiveFilter]);

  return (
    <header className="splatera-header" data-tauri-drag-region ref={headerRef}>

      <div className="header-logo">
        <Logo size={40} />
      </div>

      <div className="header-main-controls">
        <div className="search-container">
          <Input
            icon={FolderSearch}
            type="text"
            placeholder="Type to ponder..."
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
          />
        </div>

        <ColorPicker
          color={pickerColor}
          onChange={setPickerColor}
        />

        <Button
          icon={Import}
          text={<span className="import-text">Import a new file</span>}
          onClick={handleImport}
          className="import-btn"
          tooltip="Import"
          tooltipPosition="bottom"
        />
      </div>

      <div className="header-secondary-controls">
        <div className="suggested-tags">
          <span className="tags-label">Suggested tags:</span>
          <div onClick={togglePng}>
            <Label text="PNG" isActive={activeFilter === 'png'} />
          </div>
          <div onClick={toggleSvg}>
            <Label text="SVG" isActive={activeFilter === 'svg'} />
          </div>
          <div onClick={toggleTxt}>
            <Label text="Text" isActive={activeFilter === 'txt'} />
          </div>
          <div onClick={toggleImages}>
            <Label text="Images" isActive={activeFilter === 'images'} />
          </div>
        </div>

        <div className="action-buttons">
          <SortMenu sortOrder={sortOrder} setSortOrder={setSortOrder} />
          <FilterMenu
            pickerColor={pickerColor}
            setPickerColor={setPickerColor}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            dateFilter={dateFilter}
            setDateFilter={setDateFilter}
          />
          <SettingsMenu
            viewMode={viewMode}
            setViewMode={setViewMode}
          />
        </div>
      </div>

      <div className="window-controls">
        <Button icon={Minimize2} onClick={handleMinimize} className="control-btn" tooltip="Minimize" tooltipPosition="bottom" />
        <Button icon={Maximize} onClick={handleToggleMaximize} className="control-btn" tooltip="Maximize" tooltipPosition="bottom" />
        <Button icon={CircleX} onClick={handleClose} className="control-btn close-btn" tooltip="Close" tooltipPosition="bottom" />
      </div>

    </header>
  );
});