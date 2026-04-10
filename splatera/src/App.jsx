import React, { useState, useEffect, useRef, useMemo, useDeferredValue, memo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  const [notif, setNotif] = useState({ show: false, title: '', desc: '', progress: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [activeFilter, setActiveFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState('date_desc');
  const [pickerColor, setPickerColor] = useState('#FFD16D');
  const [selectedColor, setSelectedColor] = useState(null);
  const [dateFilter, setDateFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [renameData, setRenameData] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Pagination state
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const LIMIT = 30;

  const notifTimeout = useRef(null);
  const hasLoadedOnce = useRef(false);

  const showTemporaryNotif = (title, desc) => {
    if (notifTimeout.current) clearTimeout(notifTimeout.current);
    setNotif({ show: true, title, desc, progress: null });
    notifTimeout.current = setTimeout(() => {
      setNotif(prev => ({ ...prev, show: false }));
    }, 3000);
  };

  const handleConfirmImport = async (confirmedFiles) => {
    setPendingImport(null);
    const totalPaths = confirmedFiles.length;
    let totalAssetsProcessed = 0;

    setNotif({ show: true, title: 'Processing Assets', desc: `Preparing...`, progress: 0 });

    for (let i = 0; i < totalPaths; i++) {
      const { path, tags, batchName } = confirmedFiles[i];
      try {
        const assets = await invoke('process_asset', { path });
        for (const assetInfo of assets) {
          totalAssetsProcessed++;
          if (tags.length > 0) {
            const mergedTags = [...new Set([...assetInfo.tags, ...tags])];
            await invoke('update_asset_tags', { id: assetInfo.id, tags: mergedTags });
          }
          if (batchName.trim()) {
            const needsNumber = totalPaths > 1 || assets.length > 1;
            const finalName = needsNumber ? `${batchName}_${totalAssetsProcessed}` : batchName;
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

    setRefreshTrigger(prev => prev + 1);
    showTemporaryNotif('Process Complete', `Successfully imported ${totalAssetsProcessed} files.`);
  };

  const loadLibrary = async (tag, search, tags, color, date, sort, currentOffset = 0, append = false) => {
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
  };

  const loadMore = () => {
    if (isLoadingMore || !hasMore) return;
    const nextOffset = offset + LIMIT;
    setOffset(nextOffset);
    loadLibrary(activeFilter, searchQuery, selectedTags, selectedColor, dateFilter, sortOrder, nextOffset, true);
  };

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

  const confirmRename = async (newName) => {
    if (newName && newName !== renameData.name) {
      try {
        await invoke('rename_asset', { id: renameData.id, newName });
        setRefreshTrigger(prev => prev + 1);
      } catch (err) {
        console.error("Rename failed:", err);
      }
    }
    setRenameData(null);
  };

  const handleSaveTags = async (assetId, updatedTags) => {
    try {
      await invoke('update_asset_tags', { id: assetId, tags: updatedTags });
      setRefreshTrigger(prev => prev + 1);
      showTemporaryNotif('Tags Updated', 'Tags saved successfully.');
    } catch (err) {
      console.error('Failed to update tags:', err);
      showTemporaryNotif('Error', 'Failed to save tags.');
    }
    setTagData(null);
  };

  useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    const handleReload = () => setRefreshTrigger(prev => prev + 1);
    const handleRenameModal = (e) => setRenameData(e.detail);
    const handleTagModal = (e) => setTagData(e.detail);
    const handleOpenLightbox = (e) => setSelectedFile(e.detail);
    const handleGlobalNotif = (e) => showTemporaryNotif(e.detail.title, e.detail.desc);
    const handleImportFiles = (e) => {
      const { filePaths } = e.detail;
      if (filePaths?.length) setPendingImport(filePaths);
    };

    window.addEventListener('reload-library', handleReload);
    window.addEventListener('open-rename-modal', handleRenameModal);
    window.addEventListener('open-tag-modal', handleTagModal);
    window.addEventListener('open-lightbox', handleOpenLightbox);
    window.addEventListener('show-notification', handleGlobalNotif);
    window.addEventListener('import-files', handleImportFiles);

    const unlistenDragEnter = listen('tauri://drag-enter', () => setIsDragging(true));
    const unlistenDragLeave = listen('tauri://drag-leave', () => setIsDragging(false));
    const unlistenDrop = listen('tauri://drag-drop', (event) => {
      setIsDragging(false);
      const filePaths = event.payload.paths;
      if (filePaths?.length) setPendingImport(filePaths);
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
      unlistenDragEnter.then(u => u());
      unlistenDragLeave.then(u => u());
      unlistenDrop.then(u => u());
    };
  }, []);

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

  return (
    <div className={`app-container ${isDragging ? 'dragging' : ''}`}>
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
        setViewMode={setViewMode}
      />

      <Notification
        isVisible={notif.show}
        title={notif.title}
        description={notif.desc}
        progress={notif.progress}
      />

      <div className="content-container">
        {initialLoading ? (
          <ErrorBoundary resetDeps={initialLoading} fallback={null}>
            <LibraryGrid items={SKELETON_ITEMS} viewMode={viewMode} />
          </ErrorBoundary>
        ) : deferredImages.length === 0 ? (
          <div className="empty-state">
            <h2>Drop to stash</h2>
            <p>Перетащи сюда картинки</p>
          </div>
        ) : (
          <LibraryGrid
            items={deferredImages}
            refreshTrigger={refreshTrigger}
            viewMode={viewMode}
            loadMore={loadMore}
            hasMore={hasMore}
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
      {selectedFile && <Lightbox file={selectedFile} onClose={() => setSelectedFile(null)} />}
      {pendingImport && (
        <ImportModal
          paths={pendingImport}
          onConfirm={handleConfirmImport}
          onClose={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}

// ─── Justified layout positioner ─────────────────────────────────────────────

const useJustifiedPositioner = ({ width, items, gutter = 15, targetHeight = 280 }) => {
  return useMemo(() => {
    const coords = [];
    let currentY = 0;
    let i = 0;

    while (i < items.length) {
      let rowItems = [];
      let rowAspectRatio = 0;

      while (i < items.length) {
        const item = items[i];
        const itemAR = (item.width && item.height) ? (item.width / item.height) : 1;
        rowItems.push({ index: i, ar: itemAR });
        rowAspectRatio += itemAR;
        i++;
        const predictedRowHeight = (width - (rowItems.length - 1) * gutter) / rowAspectRatio;
        if (predictedRowHeight < targetHeight && rowItems.length > 1) break;
      }

      const availableWidth = width - (rowItems.length - 1) * gutter;
      const isLastRow = i === items.length;
      const rowHeight = isLastRow
        ? Math.min(targetHeight, availableWidth / rowAspectRatio)
        : availableWidth / rowAspectRatio;

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
      estimateHeight: () => (items.length / 4) * targetHeight,
      get: (index) => coords[index],
      all: () => coords,
      set: () => { }, update: () => { }, shortestColumn: () => 0,
      columnWidth: 1, columnCount: 1, size: () => coords.length,
      range: (lo, hi, cb) => {
        for (let idx = 0; idx < coords.length; idx++) {
          const item = coords[idx];
          if (item && item.top + item.height > lo && item.top < hi) cb(idx, item.left, item.top);
        }
      }
    };
  }, [width, items, gutter, targetHeight]);
};

// ─── LibraryGrid ─────────────────────────────────────────────────────────────

const LibraryGrid = memo(({ items, refreshTrigger, viewMode, loadMore, hasMore }) => {
  const containerRef = useRef(null);
  const headerRef = useRef(null);
  const resizeTimer = useRef(null);
  const loaderRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(window.innerWidth);

  useEffect(() => {
    if (!loadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' } // Load more before we actually hit the bottom
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [loadMore, hasMore, items.length]);

  useEffect(() => {
    headerRef.current = document.querySelector('.splatera-header');
    const wrapper = containerRef.current;
    let lastWidth = window.innerWidth;

    let rafId;
    const observer = new ResizeObserver(([entry]) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const newWidth = entry.contentRect.width;

        // ONLY trigger resizing logic if the WIDTH changed.
        // Ignore height changes from search/filter.
        if (Math.abs(newWidth - lastWidth) > 1) {
          if (wrapper && !wrapper.classList.contains('is-resizing')) {
            wrapper.classList.add('is-resizing');
          }
          if (resizeTimer.current) clearTimeout(resizeTimer.current);
          resizeTimer.current = setTimeout(() => {
            wrapper?.classList.remove('is-resizing');
          }, 120);

          lastWidth = newWidth;
          setContainerWidth(newWidth);
        }
      });
    });
    if (wrapper) observer.observe(wrapper);

    let debounceTimer = null;
    let unlistenResize = null;
    getCurrentWindow().onResized(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        invoke('recalculate_db').catch(err => console.error("recalculate_db failed:", err));
      }, 500);
    }).then(u => { unlistenResize = u; }).catch(() => { });

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    let scrollTimeout;
    const handleScroll = () => {
      if (headerRef.current?.hasAttribute('data-tauri-drag-region')) {
        headerRef.current.removeAttribute('data-tauri-drag-region');
      }
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        headerRef.current?.setAttribute('data-tauri-drag-region', '');
      }, 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const minColumnWidth = 320;
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
              render={Card}
              itemKey={(data) => data.id}
              height={window.innerHeight}
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