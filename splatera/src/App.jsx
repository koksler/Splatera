import React, { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, memo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { MasonryScroller, usePositioner } from 'masonic';

import './App.css';
import Header from './components/header';
import Card from './components/card';
import Notification from './components/notification';
import Lightbox from './components/lightbox';
import InputModal from './components/inputModal';
import DropOverlay from './components/dropOverlay';
import TagManager from './components/tagManager';
import ImportModal from './components/importModal';
import ErrorBoundary from './components/errorBoundary';
import HelpDock from './components/HelpDock';
import ScrollOverlay from './components/scrollOverlay';
import TagCarousel from './components/TagCarousel';


const SKELETON_ITEMS = Array.from({ length: 12 }).map((_, i) => ({
  id: `skeleton-${i}`,
  isSkeleton: true,
  width: 320,
  height: 200 + (i % 5) * 40
}));

const formatTag = (tag) => {
  if (!tag) return '';
  const upperCaseTags = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'txt', 'md', 'json', 'html', 'css', 'js'];
  if (upperCaseTags.includes(tag.toLowerCase())) return tag.toUpperCase();
  return tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
};

const mapAsset = (assetInfo) => {
  if (!assetInfo?.id) {
    console.warn('mapAsset: missing id', assetInfo);
    return null;
  }
  return {
    id: assetInfo.id,
    name: assetInfo.file_name,
    path: assetInfo.original_path,
    originalSrc: assetInfo.original_path ? convertFileSrc(assetInfo.original_path) : '',
    preview: assetInfo.preview_path ? convertFileSrc(assetInfo.preview_path) : '',
    tags: (assetInfo.tags || []).map(formatTag),
    kind: assetInfo.kind,
    width: assetInfo.width,
    height: assetInfo.height,
    created_at: assetInfo.created_at,
    last_modified_os: assetInfo.last_modified_os,
    contentSnippet: assetInfo.content_snippet,
    previewPath: assetInfo.preview_path ?? null,
    isBroken: assetInfo.is_broken ?? false,
  };
};

const positionerRef = { current: null };

const ItemWrapper = React.forwardRef(({ children, style, ...rest }, ref) => {
  const idx = children?.props?.index;
  if (idx !== undefined && positionerRef.current) {
    const pos = positionerRef.current.get(idx);
    if (pos) {
      if (pos.width) style.width = pos.width;
      if (pos.height) style.height = pos.height;
    }
  }
  return <div ref={ref} className="masonic-item-wrapper" style={{ ...style, display: 'flex' }} {...rest}>{children}</div>;
});

function App() {
  const [tagData, setTagData] = useState(null);
  const [images, setImages] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [notif, setNotif] = useState({ show: false, title: '', desc: '', progress: null, undoId: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [activeFilter, setActiveFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState('date_desc');
  const [pickerColor, setPickerColor] = useState('#FFD16D');
  const [selectedColor, setSelectedColor] = useState(null);
  const [dateFilter, setDateFilter] = useState('');
  // lightboxIndex: index into `images` of the currently open lightbox item
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [renameData, setRenameData] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [importHasTemp, setImportHasTemp] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [snapHeader, setSnapHeader] = useState(false);
  const [themeMode, setThemeMode] = useState('System');
  const [rangeVal, setRangeVal] = useState(60);
  const [autoplay, setAutoplay] = useState(false);
  const [tagPreviews, setTagPreviews] = useState([]);
  const settingsRef = useRef({});
  const saveDebounceRef = useRef(null);

  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const lastSelectedIndexRef = useRef(null);

  const toggleSelectAsset = useCallback((asset, index, isShiftPressed) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);

      if (isShiftPressed && lastSelectedIndexRef.current !== null && typeof index === 'number') {
        const start = Math.min(lastSelectedIndexRef.current, index);
        const end = Math.max(lastSelectedIndexRef.current, index);
        for (let i = start; i <= end; i++) {
          if (images[i] && images[i].id) {
            next.add(images[i].id);
          }
        }
      } else {
        if (next.has(asset.id)) {
          next.delete(asset.id);
        } else {
          next.add(asset.id);
        }
      }

      return next;
    });

    if (typeof index === 'number') {
      lastSelectedIndexRef.current = index;
    }
  }, [images]);

  const unselectAsset = useCallback((id) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedAssetIds(new Set());
    lastSelectedIndexRef.current = null;
  }, []);

  const selectedAssets = useMemo(() => {
    if (selectedAssetIds.size === 0) return [];
    return images.filter((img) => selectedAssetIds.has(img.id));
  }, [images, selectedAssetIds]);


  // Pagination state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const LIMIT = 30;

  const notifTimeout = useRef(null);
  // Undo delete: stores { id, image } for the pending undo window
  const undoRef = useRef(null);
  // Always-current ref to images for use inside stale closures (event handlers)
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const hasLoadedOnce = useRef(false);

  const showTemporaryNotif = (title, desc, opts = {}) => {
    if (notifTimeout.current) clearTimeout(notifTimeout.current);
    setNotif({ show: true, title, desc, progress: opts.progress ?? null, undoId: opts.undoId ?? null });
    notifTimeout.current = setTimeout(() => {
      setNotif(prev => ({ ...prev, show: false }));
      undoRef.current = null;
    }, opts.duration ?? 3000);
  };

  const handleConfirmImport = async (confirmedFiles, saveLocally) => {
    setPendingImport(null);
    setImportHasTemp(false);
    setNotif({ show: true, title: 'Processing Assets', desc: `Preparing...`, progress: 0 });

    const expandedFiles = [];
    for (const file of confirmedFiles) {
      try {
        const paths = await invoke('expand_directory', { path: file.path });
        for (const p of paths) {
          expandedFiles.push({
            path: p,
            tags: file.tags,
            batchName: file.batchName
          });
        }
      } catch (err) {
        console.error("Failed to expand directory:", file.path, err);
        expandedFiles.push(file);
      }
    }

    const totalPaths = expandedFiles.length;
    let totalAssetsProcessed = 0;

    const createdAssetIds = [];
    const copiedPaths = [];

    for (let i = 0; i < totalPaths; i++) {
      let { path, tags, batchName } = expandedFiles[i];
      try {
        if (saveLocally) {
          try {
            const localPath = await invoke('copy_to_local_library', { path });
            if (localPath !== path) {
              copiedPaths.push(localPath);
              path = localPath;
            }
          } catch (copyErr) {
            console.error("Failed to copy file locally, falling back to original path:", copyErr);
          }
        }
        const assets = await invoke('process_asset', { path });
        for (const assetInfo of assets) {
          totalAssetsProcessed++;
          createdAssetIds.push(assetInfo.id);
          if (tags.length > 0) {
            const mergedTags = [...new Set([...assetInfo.tags, ...tags])];
            await invoke('update_asset_tags', { id: assetInfo.id, tags: mergedTags });
          }
          if (batchName.trim()) {
            const origName = assetInfo.file_name || assetInfo.metadata?.file_name || '';
            const origExt = origName.includes('.') ? origName.split('.').pop() : (assetInfo.extension || '');
            const hasExt = batchName.includes('.');
            const baseRename = hasExt ? batchName.slice(0, batchName.lastIndexOf('.')) : batchName;
            const extToUse = hasExt ? batchName.slice(batchName.lastIndexOf('.')) : (origExt ? `.${origExt}` : '');

            const needsNumber = totalPaths > 1 || assets.length > 1;
            const finalName = needsNumber ? `${baseRename}_${totalAssetsProcessed}${extToUse}` : `${baseRename}${extToUse}`;
            await invoke('rename_asset', { id: assetInfo.id, newName: finalName });
          }
        }
        setNotif(prev => ({
          ...prev,
          desc: `Processed ${i + 1} of ${totalPaths} entries...`,
          progress: ((i + 1) / totalPaths) * 100,
        }));
      } catch (err) {
        console.error("Error processing path:", path, err);
      }
    }

    let importOpId = null;
    if (createdAssetIds.length > 0) {
      try {
        importOpId = await invoke('log_import_operation', { assetIds: createdAssetIds, copiedPaths });
      } catch (logErr) {
        console.error('Failed to log import operation:', logErr);
      }
    }

    setRefreshTrigger(prev => prev + 1);
    showTemporaryNotif('Process Complete', `Successfully imported ${totalAssetsProcessed} files.`, {
      undoId: importOpId,
      duration: 6000
    });
  };

  const loadLibrary = useCallback(async (tag, search, tags, color, date, sort, currentOffset = 0, append = false) => {
    if (!hasLoadedOnce.current && currentOffset === 0) {
      setInitialLoading(true);
    }
    if (currentOffset !== 0) {
      setIsLoadingMore(true);
    }

    try {
      const assets = await invoke('get_library', {
        query: {
          filter_tag: tag,
          query: search || null,
          tags: tags && tags.length > 0 ? tags : null,
          color: color || null,
          date: date || null,
          sort: sort || null,
          limit: LIMIT,
          offset: currentOffset
        }
      });
      const mapped = assets.map(mapAsset).filter(Boolean);

      setHasMore(mapped.length === LIMIT);

      setImages(prevImages => {
        if (!append) return mapped;

        const prevMap = new Map(prevImages.map(img => [img.id, img]));
        const seenIds = new Set();
        const result = [...prevImages];

        for (const newImg of mapped) {
          if (prevMap.has(newImg.id)) continue;
          if (seenIds.has(newImg.id)) continue;
          seenIds.add(newImg.id);
          result.push(newImg);
        }
        return result;
      });
    } catch (error) {
      console.error("Error loading library:", error);
    } finally {
      if (currentOffset === 0) {
        hasLoadedOnce.current = true;
        setInitialLoading(false);
      }
      setIsLoadingMore(false);
    }
  }, []);

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    const nextOffset = offset + LIMIT;
    setOffset(nextOffset);
    loadLibrary(activeFilter, searchQuery, selectedTags, selectedColor, dateFilter, sortOrder, nextOffset, true);
  }, [isLoadingMore, hasMore, offset, loadLibrary, activeFilter, searchQuery, selectedTags, selectedColor, dateFilter, sortOrder]);

  // Debounced library loading — offloads O(N) filtering to Rust.
  // This is the "Magic Sauce" that makes the UI instant and drops RAM usage.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setHasMore(true);
      loadLibrary(activeFilter, searchQuery, selectedTags, selectedColor, dateFilter, sortOrder, 0, false);
    }, searchQuery || dateFilter ? 150 : 0);

    return () => clearTimeout(timer);
  }, [activeFilter, searchQuery, selectedTags, selectedColor, dateFilter, sortOrder, refreshTrigger]);

  // Load tag previews on mount and when library changes
  useEffect(() => {
    invoke('get_tag_previews')
      .then(previews => setTagPreviews(previews))
      .catch(err => console.error('Failed to load tag previews:', err));
  }, [refreshTrigger]);

  const confirmRename = async (newName) => {
    if (newName && renameData) {
      try {
        const origName = renameData.file_name || renameData.name || '';
        const origExt = origName.includes('.') ? origName.split('.').pop() : (renameData.extension || '');
        const hasExt = newName.includes('.');
        const finalName = hasExt ? newName : (origExt ? `${newName}.${origExt}` : newName);

        await invoke('rename_asset', { id: renameData.id, newName: finalName });
        setRefreshTrigger((prev) => prev + 1);
        showTemporaryNotif('Renamed', 'Asset renamed successfully.');
      } catch (err) {
        console.error("Rename failed:", err);
      }
    }
    setRenameData(null);
  };

  const handleSaveTags = async (target, updatedTags) => {
    try {
      const idsToUpdate = target?.isBatch
        ? target.ids
        : [typeof target === 'string' ? target : target?.id];

      if (idsToUpdate && idsToUpdate.length > 0) {
        for (const id of idsToUpdate) {
          if (id) {
            await invoke('update_asset_tags', { id, tags: updatedTags });
          }
        }
        showTemporaryNotif('Tags Updated', `Tags saved for ${idsToUpdate.length} asset${idsToUpdate.length === 1 ? '' : 's'}.`);
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (err) {
      console.error('Failed to update tags:', err);
      showTemporaryNotif('Error', 'Failed to save tags.');
    }
    setTagData(null);
  };

  const handleBatchTag = useCallback((assetsToTag) => {
    if (!assetsToTag || assetsToTag.length === 0) return;
    const combinedTags = Array.from(new Set(assetsToTag.flatMap(a => a.tags || [])));
    setTagData({
      isBatch: true,
      ids: assetsToTag.map(a => a.id),
      assets: assetsToTag,
      tags: combinedTags,
      name: `${assetsToTag.length} selected assets`,
    });
  }, []);

  const handleBatchDelete = useCallback(async (assetsToDelete) => {
    if (!assetsToDelete || assetsToDelete.length === 0) return;
    const deletedIds = new Set(assetsToDelete.map(a => a.id));

    // Optimistically update UI
    setImages(prev => prev.filter(img => !deletedIds.has(img.id)));
    clearSelection();

    try {
      const lastOpId = await invoke('delete_assets_batch', { ids: assetsToDelete.map(a => a.id) });
      setRefreshTrigger(prev => prev + 1);
      showTemporaryNotif('Assets Removed', `${assetsToDelete.length} file(s) removed from library.`, { undoId: lastOpId, duration: 5000 });
    } catch (err) {
      console.error('Failed to batch delete:', err);
      setRefreshTrigger(prev => prev + 1);
      showTemporaryNotif('Delete Error', 'Some assets could not be deleted.');
    }
  }, [clearSelection]);

  const startImportFlow = async (filePaths) => {
    if (!filePaths || filePaths.length === 0) return;
    try {
      // Unpack directories using expand_directory
      let expandedPaths = [];
      for (const p of filePaths) {
        try {
          const res = await invoke('expand_directory', { path: p });
          if (res && res.length > 0) {
            expandedPaths.push(...res);
          } else {
            expandedPaths.push(p);
          }
        } catch {
          expandedPaths.push(p);
        }
      }

      const prepResult = await invoke('prepare_dropped_paths', { paths: expandedPaths });
      const safePaths = prepResult.paths;
      const hasTemp = prepResult.has_temp;

      const checkResult = await invoke('check_import_paths', { paths: safePaths });
      const { allowed_paths, duplicate_paths, duplicate_hashes } = checkResult;

      if (duplicate_paths.length > 0 || duplicate_hashes.length > 0) {
        let desc = '';
        if (duplicate_paths.length > 0) {
          desc += `${duplicate_paths.length} file(s) already in library. `;
        }
        if (duplicate_hashes.length > 0) {
          desc += `${duplicate_hashes.length} duplicate file(s) skipped (same hash).`;
        }
        showTemporaryNotif('Duplicates Skipped', desc.trim());
      }

      if (allowed_paths.length > 0) {
        setImportHasTemp((prev) => prev || hasTemp);
        setPendingImport((prev) => (prev ? [...new Set([...prev, ...allowed_paths])] : allowed_paths));
      }
    } catch (err) {
      console.error("Import checking failed, fallback to direct import:", err);
      setPendingImport((prev) => (prev ? [...new Set([...prev, ...filePaths])] : filePaths));
    }
  };

  useEffect(() => {
    invoke('show_window').catch(console.error);

    // Load settings from settings.json
    invoke('load_settings')
      .then((settingsStr) => {
        try {
          const settings = JSON.parse(settingsStr);
          settingsRef.current = settings;
          if (settings.snapHeader !== undefined) {
            setSnapHeader(settings.snapHeader);
          }
          if (settings.themeMode !== undefined) {
            setThemeMode(settings.themeMode);
          }
          if (settings.rangeVal !== undefined) {
            setRangeVal(settings.rangeVal);
          }
          if (settings.autoplay !== undefined) {
            setAutoplay(settings.autoplay);
            window.dispatchEvent(new CustomEvent('set-autoplay-videos', { detail: settings.autoplay }));
          }
          if (settings.viewMode !== undefined) {
            setViewMode(settings.viewMode);
          }
        } catch (e) {
          console.error("Failed to parse settings.json", e);
        }
      })
      .catch((err) => {
        console.error("Failed to load settings", err);
      });

    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    const handleReload = () => setRefreshTrigger(prev => prev + 1);
    const handleRenameModal = (e) => setRenameData(e.detail);
    const handleTagModal = (e) => setTagData(e.detail);
    const handleOpenLightbox = (e) => {
      const idx = imagesRef.current.findIndex(img => img.id === e.detail.id);
      setLightboxIndex(idx >= 0 ? idx : 0);
    };
    const handleGlobalNotif = (e) => {
      const { title, desc, undoId, progress, duration } = e.detail;
      showTemporaryNotif(title, desc, { undoId, progress, duration });
    };
    // Optimistic delete dispatched from card.jsx
    const handleOptimisticDelete = (e) => {
      const { id, image, opId, isDevice } = e.detail;
      setImages(prev => prev.filter(img => img.id !== id));
      if (isDevice) {
        undoRef.current = null;
        showTemporaryNotif('Deleted from Device', 'Asset(s) have been moved to the trash bin', { undoId: null, duration: 3500 });
      } else {
        undoRef.current = { id, image, opId };
        showTemporaryNotif('Asset Removed', `"${image.name}" removed from library. Undo?`, { undoId: opId, duration: 5000 });
      }
    };
    window.addEventListener('optimistic-delete', handleOptimisticDelete);
    const handleImportFiles = (e) => {
      const { filePaths } = e.detail;
      if (filePaths?.length) startImportFlow(filePaths);
    };

    window.addEventListener('reload-library', handleReload);
    window.addEventListener('open-rename-modal', handleRenameModal);
    window.addEventListener('open-tag-modal', handleTagModal);
    window.addEventListener('open-lightbox', handleOpenLightbox);
    window.addEventListener('show-notification', handleGlobalNotif);
    window.addEventListener('import-files', handleImportFiles);

    const unlistenDragEnter = listen('tauri://drag-enter', () => setIsDragging(true));
    const unlistenDragLeave = listen('tauri://drag-leave', () => setIsDragging(false));
    const unlistenDrop = listen('tauri://drag-drop', async (event) => {
      setIsDragging(false);
      const filePaths = event.payload.paths;
      if (!filePaths?.length) return;
      startImportFlow(filePaths);
    });

    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
      window.removeEventListener('reload-library', handleReload);
      window.removeEventListener('open-rename-modal', handleRenameModal);
      window.removeEventListener('open-tag-modal', handleTagModal);
      window.removeEventListener('open-lightbox', handleOpenLightbox);
      window.removeEventListener('show-notification', handleGlobalNotif);
      window.removeEventListener('import-files', handleImportFiles);
      window.removeEventListener('optimistic-delete', handleOptimisticDelete);
      unlistenDragEnter.then(u => u());
      unlistenDragLeave.then(u => u());
      unlistenDrop.then(u => u());
      if (notifTimeout.current) clearTimeout(notifTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (snapHeader) {
      document.documentElement.style.setProperty('--scrollbar-track-margin-top', '75px');
    } else {
      document.documentElement.style.setProperty('--scrollbar-track-margin-top', '160px');
    }
  }, [snapHeader]);

  useEffect(() => {
    const applyTheme = (mode) => {
      let activeMode = mode;
      if (mode === 'System') {
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        activeMode = systemPrefersDark ? 'Dark' : 'Light';
      }

      if (activeMode === 'Light') {
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
      } else {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
      }
    };

    applyTheme(themeMode);

    if (themeMode === 'System') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e) => {
        const activeMode = e.matches ? 'Dark' : 'Light';
        if (activeMode === 'Light') {
          document.body.classList.add('theme-light');
          document.body.classList.remove('theme-dark');
        } else {
          document.body.classList.add('theme-dark');
          document.body.classList.remove('theme-light');
        }
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [themeMode]);

  useEffect(() => {
    let scrollTimeout;
    const container = document.querySelector('.app-container');
    const handleScroll = () => {
      if (!container) return;
      container.classList.add('is-scrolling');
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => container.classList.remove('is-scrolling'), 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const deferredImages = useDeferredValue(images);

  // Lightbox navigation helpers
  const openLightbox = useCallback((idx) => {
    setLightboxIndex(Math.max(0, Math.min(idx, imagesRef.current.length - 1)));
  }, []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const lightboxFile = lightboxIndex !== null ? deferredImages[lightboxIndex] : null;

  // Undo operation handler
  const handleUndo = async () => {
    const savedImage = undoRef.current?.image;
    const targetOpId = notif.undoId || undoRef.current?.opId;
    try {
      const res = await invoke('undo_last_operation', { opId: targetOpId || null });
      if (res.op_type === 'delete') {
        if (savedImage) {
          setImages(prev => [savedImage, ...prev]);
        }
        showTemporaryNotif('Action Aborted', 'Asset restored to library.');
      } else if (res.op_type === 'import') {
        showTemporaryNotif('Import Undone', `Removed ${res.count} imported files.`);
      }
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Undo failed:', err);
      if (savedImage) {
        setImages(prev => [savedImage, ...prev]);
        showTemporaryNotif('Restored', 'Restored in-memory asset view.');
      }
    } finally {
      undoRef.current = null;
    }
  };

  const saveAppSetting = async (key, value) => {
    const updatedSettings = { ...settingsRef.current, [key]: value };
    settingsRef.current = updatedSettings;
    try {
      await invoke('save_settings', { settings: JSON.stringify(updatedSettings) });
    } catch (err) {
      console.error("Failed to save settings", err);
    }
  };

  const handleToggleSnapHeader = (nextValue) => {
    setSnapHeader(nextValue);
    saveAppSetting('snapHeader', nextValue);
  };

  const handleThemeModeChange = (nextValue) => {
    setThemeMode(nextValue);
    saveAppSetting('themeMode', nextValue);
  };

  const handleRangeValChange = (nextValue) => {
    setRangeVal(nextValue);
    settingsRef.current = { ...settingsRef.current, rangeVal: nextValue };
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      invoke('save_settings', { settings: JSON.stringify(settingsRef.current) })
        .catch(err => console.error('Failed to save settings', err));
    }, 300);
  };

  const handleAutoplayChange = (nextValue) => {
    setAutoplay(nextValue);
    window.dispatchEvent(new CustomEvent('set-autoplay-videos', { detail: nextValue }));
    saveAppSetting('autoplay', nextValue);
  };

  const handleViewModeChange = (nextValue) => {
    setViewMode(nextValue);
    saveAppSetting('viewMode', nextValue);
  };

  const isSearchActive = searchQuery.trim() !== '' ||
    selectedTags.length > 0 ||
    selectedColor !== null ||
    dateFilter.trim() !== '' ||
    (activeFilter !== null && activeFilter !== '');

  const emptyStateContent = isSearchActive ? {
    title: "Oh.\nQuery yielded no results.",
    desc: "Maybe some tags got messed up, or you\ncould've skipped a letter. Or it's a bug."
  } : {
    title: "Oh, right.\nThe database is empty.",
    desc: "You can always fix it by importing something\nOr just drag & drop it into application"
  };

  return (
    <div className={`app-container ${isDragging ? 'dragging' : ''} ${selectedAssetIds.size > 0 ? 'has-selection' : ''}`}>
      <Header
        selectedColor={selectedColor}
        clearColor={() => setSelectedColor(null)}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        pickerColor={pickerColor}
        setPickerColor={(color) => { setPickerColor(color); setSelectedColor(color); }}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        viewMode={viewMode}
        setViewMode={handleViewModeChange}
        snapHeader={snapHeader}
        onSnapHeaderChange={handleToggleSnapHeader}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        rangeVal={rangeVal}
        onRangeValChange={handleRangeValChange}
        autoplay={autoplay}
        onAutoplayChange={handleAutoplayChange}
      />

      <Notification
        isVisible={notif.show}
        title={notif.title}
        description={notif.desc}
        progress={notif.progress}
        undoId={notif.undoId}
        onUndo={handleUndo}
      />

      {!initialLoading && !searchQuery && selectedTags.length === 0 && !selectedColor && !dateFilter && !activeFilter && tagPreviews.length > 0 && (
        <TagCarousel
          tags={tagPreviews}
          onTagClick={(tag) => {
            setSelectedTags([tag]);
          }}
        />
      )}

      <div className="content-container">
        {initialLoading ? (
          <ErrorBoundary resetDeps={initialLoading} fallback={null}>
            <LibraryGrid items={SKELETON_ITEMS} viewMode={viewMode} rangeVal={rangeVal} />
          </ErrorBoundary>
        ) : deferredImages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-smile">:(</div>
            <div className="empty-state-title">{emptyStateContent.title}</div>
            <div className="empty-state-desc">{emptyStateContent.desc}</div>
            <div className="empty-state-code">APP-ER-404</div>
          </div>
        ) : (
          <LibraryGrid
            items={deferredImages}
            refreshTrigger={refreshTrigger}
            viewMode={viewMode}
            loadMore={loadMore}
            hasMore={hasMore}
            onOpenLightbox={openLightbox}
            selectedAssetIds={selectedAssetIds}
            onToggleSelect={toggleSelectAsset}
            rangeVal={rangeVal}
          />
        )}
      </div>

      {renameData && (
        <InputModal
          title="Enter new display name:"
          data={renameData}
          onConfirm={confirmRename}
          onCancel={() => setRenameData(null)}
        />
      )}
      {tagData && (
        <TagManager
          data={tagData}
          onSave={handleSaveTags}
          onClose={() => setTagData(null)}
        />
      )}
      {isDragging && <DropOverlay />}
      {lightboxFile && (
        <Lightbox
          file={lightboxFile}
          onClose={closeLightbox}
          onPrev={lightboxIndex > 0 ? () => openLightbox(lightboxIndex - 1) : null}
          onNext={lightboxIndex < deferredImages.length - 1 ? () => openLightbox(lightboxIndex + 1) : null}
        />
      )}
      {pendingImport && (
        <ImportModal
          paths={pendingImport}
          hasTemp={importHasTemp}
          onConfirm={handleConfirmImport}
          onClose={() => {
            setPendingImport(null);
            setImportHasTemp(false);
          }}
        />
      )}

      <HelpDock
        selectedAssets={selectedAssets}
        onUnselectAsset={unselectAsset}
        onClearSelection={clearSelection}
        onBatchTag={handleBatchTag}
        onBatchDelete={handleBatchDelete}
      />
      <ScrollOverlay />
    </div>
  );

}

// ─── Justified layout positioner ─────────────────────────────────────────────

const useJustifiedPositioner = ({ width, items = [], gutter = 15, targetHeight = 280 }) => {
  return useMemo(() => {
    const coords = [];
    if (!width || !items || items.length === 0) {
      return {
        width: width || 0,
        height: 0,
        estimateHeight: () => 0,
        get: () => undefined,
        all: () => [],
        set: () => { }, update: () => { }, shortestColumn: () => 0,
        columnWidth: 1, columnCount: 1, size: () => 0,
        range: () => { }
      };
    }

    let currentY = 0;
    let i = 0;

    while (i < items.length) {
      let rowItems = [];
      let rowAspectRatio = 0;

      while (i < items.length) {
        const curItem = items[i];
        const rawAR = (curItem && curItem.width && curItem.height) ? (curItem.width / curItem.height) : 1;
        const itemAR = Math.min(Math.max(rawAR, 0.5), 2.2);
        rowItems.push({ index: i, ar: itemAR });
        rowAspectRatio += itemAR;
        i++;
        const predictedRowHeight = (width - (rowItems.length - 1) * gutter) / rowAspectRatio;
        if (predictedRowHeight < targetHeight && rowItems.length > 1) break;
      }

      const availableWidth = width - (rowItems.length - 1) * gutter;
      const isLastRow = i === items.length;
      const maxRowHeight = targetHeight * 1.35;
      const rawRowHeight = availableWidth / rowAspectRatio;
      const rowHeight = isLastRow
        ? Math.min(targetHeight, rawRowHeight)
        : Math.min(maxRowHeight, rawRowHeight);

      let currentX = 0;
      for (const rowItem of rowItems) {
        const itemWidth = rowItem.ar * rowHeight;
        coords[rowItem.index] = { top: currentY, left: currentX, width: itemWidth, height: rowHeight };
        currentX += itemWidth + gutter;
      }
      currentY += rowHeight + gutter;
    }

    return {
      width, height: currentY,
      estimateHeight: () => currentY,
      get: (index) => coords[index],
      all: () => coords,
      set: () => { }, update: () => { }, shortestColumn: () => 0,
      columnWidth: 1, columnCount: 1, size: () => coords.length,
      range: (lo, hi, cb) => {
        for (let idx = 0; idx < coords.length; idx++) {
          const pos = coords[idx];
          if (pos && pos.top + pos.height > lo && pos.top < hi) cb(idx, pos.left, pos.top);
        }
      }
    };
  }, [width, items, gutter, targetHeight]);
};

// ─── LibraryGrid ─────────────────────────────────────────────────────────────

const LibraryGrid = memo(({ items, refreshTrigger, viewMode, loadMore, hasMore, onOpenLightbox, selectedAssetIds, onToggleSelect, rangeVal }) => {
  const containerRef = useRef(null);
  const resizeTimer = useRef(null);
  const loaderRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  useEffect(() => {
    if (!loadMore || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: '200px' }
    );
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [loadMore, hasMore, items.length]);

  useEffect(() => {
    const wrapper = containerRef.current;
    let lastWidth = window.innerWidth;
    let rafId;

    const observer = new ResizeObserver(([entry]) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const newWidth = entry.contentRect.width;
        if (Math.abs(newWidth - lastWidth) > 1) {
          if (wrapper && !wrapper.classList.contains('is-resizing')) {
            wrapper.classList.add('is-resizing');
          }
          if (resizeTimer.current) clearTimeout(resizeTimer.current);
          resizeTimer.current = setTimeout(() => wrapper?.classList.remove('is-resizing'), 120);
          lastWidth = newWidth;
          setContainerWidth(newWidth);
        }
      });
    });
    if (wrapper) observer.observe(wrapper);

    // Track viewport height for correct MasonryScroller virtualization
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    };
  }, []);

  const minColumnWidth = 150 + (rangeVal / 100) * 350;
  const standardGutter = 20;
  const numColumns = Math.max(1, Math.floor((containerWidth + standardGutter) / (minColumnWidth + standardGutter)));

  const activeColWidth = viewMode === 'horizontal'
    ? minColumnWidth
    : (containerWidth - (numColumns - 1) * standardGutter) / numColumns;

  const positioner = usePositioner(
    { width: containerWidth, columnWidth: activeColWidth, columnGutter: standardGutter, padding: 0 },
    [items, containerWidth, activeColWidth, standardGutter]
  );

  const justifiedPositioner = useJustifiedPositioner({
    width: containerWidth, items, gutter: standardGutter, targetHeight: 280
  });

  const activePositioner = viewMode === 'horizontal' ? justifiedPositioner : positioner;
  positionerRef.current = activePositioner;

  // Pass onOpenLightbox, isSelected, onToggleSelect, and hasSelection to each card via render prop
  const renderCard = useCallback(
    (props) => (
      <Card
        {...props}
        onOpenLightbox={onOpenLightbox}
        isSelected={selectedAssetIds?.has(props.data?.id)}
        onToggleSelect={onToggleSelect}
        hasSelection={selectedAssetIds?.size > 0}
      />
    ),
    [onOpenLightbox, selectedAssetIds, onToggleSelect]
  );


  return (
    <div ref={containerRef} className="masonry-wrapper" style={{ minHeight: '100vh', width: '100%' }}>
      <div style={{ width: containerWidth, margin: '0 auto' }}>
        {containerWidth > 0 && (
          <ErrorBoundary resetDeps={viewMode} fallback={null}>
            <MasonryScroller
              key={viewMode}
              positioner={activePositioner}
              items={items}
              overscanBy={2}
              itemAs={ItemWrapper}
              render={renderCard}
              itemKey={(data) => data.id}
              height={viewportHeight}
            />
          </ErrorBoundary>
        )}

        {/* Infinite Scroll Sentinel */}
        {hasMore && (
          <div ref={loaderRef} className="scroll-sentinel" style={{ height: '40px', margin: '20px 0', display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" style={{ width: '24px', height: '24px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}
      </div>
    </div>
  );
});

export default App;