import { Unlink } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import CardPopup from './cardPopup';
import ContextMenu from './contextMenu';
import './card.css';

let autoplayVideos = false;
window.addEventListener('set-autoplay-videos', (e) => {
  autoplayVideos = e.detail;
});

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.toLowerCase()] || 'text';
};

const formatDate = (timestamp) => {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp * 1000);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
};

const notify = (title, desc) => {
  window.dispatchEvent(new CustomEvent('show-notification', { detail: { title, desc } }));
};

export default memo(Card);
function Card({ data, index, onOpenLightbox, isSelected, onToggleSelect, hasSelection }) {
  const videoRef = useRef(null);
  const hoverTimeout = useRef(null);
  const [menuData, setMenuData] = useState({ open: false, x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [autoplay, setAutoplay] = useState(autoplayVideos);

  const handleMouseDown = (e) => {
    if (e.shiftKey) {
      e.preventDefault();
    }
  };

  const handleClick = (e) => {
    if (e.shiftKey || hasSelection) {
      e.preventDefault();
      e.stopPropagation();
      if (onToggleSelect) {
        onToggleSelect(data, index, e.shiftKey);
      }
    }
  };

  useEffect(() => {
    const handler = (e) => setAutoplay(e.detail);
    window.addEventListener('set-autoplay-videos', handler);
    return () => window.removeEventListener('set-autoplay-videos', handler);
  }, []);

  useEffect(() => {
    if (!data || !data.name) return;
    const ext = data.name.split('.').pop().toLowerCase();
    const isVideo = data.kind === 'Video' || ext === 'mp4' || ext === 'webm' || ext === 'mov';
    if (autoplayVideos && isVideo && videoRef.current) {
      videoRef.current.play().catch(() => { });
    }
  }, [data?.id]);

  if (!data) return null;

  if (data.isSkeleton) {
    const skeletonHeight = 200 + (parseInt(data.id.split('-')[1]) % 5) * 40;
    return <div className="skeleton-card" style={{ height: skeletonHeight }} />;
  }

  if (!data.id) return null;

  const ext = data.name.split('.').pop().toLowerCase();
  const displayName = data.name.replace(/\.[^/.]+$/, '');
  const isCodeOrText = data.kind === 'Code' || data.kind === 'Text';
  const isVideo = data.kind === 'Video' || ext === 'mp4' || ext === 'webm' || ext === 'mov';
  const isGif = ext === 'gif';
  const isAnimatable = ext === 'gif' || ext === 'webp'; // gif always, webp when animated
  const rawAspect = data.width && data.height ? data.width / data.height : 1;
  const clampedAspect = Math.min(Math.max(rawAspect, 0.5), 2.2);
  const cardAspectRatio = `${clampedAspect}`;

  const [isGifHovered, setIsGifHovered] = useState(false);

  const handleMouseEnter = () => {
    const isScrolling = document.querySelector('.app-container')?.classList.contains('is-scrolling');
    if (isScrolling) return;

    setIsHovered(true);
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      if (isGif) {
        setIsGifHovered(true);
      } else {
        videoRef.current?.play().catch(() => { });
      }
    }, 200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsGifHovered(false);
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (videoRef.current && !autoplay) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const handleDragStart = async (e) => {
    e.preventDefault();
    try {
      const rawIconPath = data.previewPath || data.path;
      const iconPath = await invoke('resolve_path', { path: rawIconPath });
      await startDrag({ item: [data.path], icon: iconPath });
    } catch {
      // Drag failed silently
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    setMenuData({ open: true, x: e.clientX, y: e.clientY });
  };

  const handleDoubleClick = () => {
    if (onOpenLightbox && typeof index === 'number') {
      onOpenLightbox(index);
    } else {
      window.dispatchEvent(new CustomEvent('open-lightbox', { detail: data }));
    }
  };

  const handleCopy = () => {
    const assetType = isCodeOrText ? 'Text' : (isVideo ? 'File' : 'Image');
    const msg = `${assetType} Copied`;
    const action = isCodeOrText ? 'copy_text_to_clipboard' : 'copy_image_to_clipboard';
    const params = isCodeOrText ? { text: data.contentSnippet || '' } : { path: data.path };

    // Fire and forget (Optimistic)
    invoke(action, params).catch((err) => {
      console.error(`${assetType} copy failed:`, err);
      notify('Copy Failed', `Could not copy ${data.name}.`);
    });

    notify(msg, `${data.name} ready to paste.`);
  };

  const handleAction = async (action) => {
    setMenuData(prev => ({ ...prev, open: false }));
    switch (action) {
      case 'copy':
        await handleCopy();
        break;
      case 'open_folder':
        try { await invoke('open_in_folder', { path: data.path }); } catch { /* silent */ }
        break;
      case 'rename':
        window.dispatchEvent(new CustomEvent('open-rename-modal', { detail: data }));
        break;
      case 'add_tag':
        window.dispatchEvent(new CustomEvent('open-tag-modal', { detail: data }));
        break;
      case 'delete':
        try {
          const opId = await invoke('delete_asset', { id: data.id });
          window.dispatchEvent(new CustomEvent('optimistic-delete', { detail: { id: data.id, image: data, opId } }));
        } catch (err) {
          console.error('Failed to delete:', err);
          window.dispatchEvent(new CustomEvent('reload-library'));
          notify('Delete Failed', `Could not delete "${data.name}".`);
        }
        break;
      case 'delete_device':
        try {
          const opId = await invoke('delete_asset_device', { id: data.id });
          window.dispatchEvent(new CustomEvent('optimistic-delete', { detail: { id: data.id, image: data, opId, isDevice: true } }));
        } catch (err) {
          console.error('Failed to delete from device:', err);
          window.dispatchEvent(new CustomEvent('reload-library'));
          notify('Delete Failed', `Could not delete "${data.name}" from device.`);
        }
        break;
      default:
        break;
    }
  };

  const PLACEHOLDER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'><rect width='1' height='1' fill='%23222222'/></svg>";

  return (
    <div
      className={`splatera-card ${isVideo ? 'is-video' : ''} ${isSelected ? 'is-selected' : ''}`}
      style={{ aspectRatio: cardAspectRatio }}
      draggable
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      {hasSelection && !isSelected && (
        <div className="card-dim-overlay" />
      )}

      {data.isBroken && (
        <div className="broken-overlay">
          <Unlink size={24} />
          <span>File missing</span>
        </div>
      )}

      {isCodeOrText ? (
        <div className="code-preview-container">
          <SyntaxHighlighter
            language={getLanguage(ext)}
            style={vscDarkPlus}
            customStyle={{
              margin: 0, padding: 0,
              background: 'transparent',
              fontSize: '11px',
              overflow: 'hidden',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
            wrapLongLines
          >
            {data.contentSnippet || 'No preview available'}
          </SyntaxHighlighter>
        </div>
      ) : isVideo ? (
        <video
          ref={videoRef}
          src={data.path ? convertFileSrc(data.path) : (data.preview || undefined)}
          muted
          loop
          playsInline
          preload="none"
          className="card-video"
          poster={data.preview || undefined}
        />
      ) : (
        <div className="img-container" style={{ background: '#222', width: '100%', height: '100%', contain: 'layout paint' }}>
          <img
            src={(isGif && isGifHovered) || (isAnimatable && autoplay) ? convertFileSrc(data.path) : (data.preview || PLACEHOLDER_IMG)}
            alt={data.name}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}

      <div className="popup-wrapper">
        <CardPopup
          title={displayName}
          dateText={formatDate(data.created_at)}
          tags={data.tags ?? [ext]}
          isSelected={isSelected}
          onToggleSelect={(e) => onToggleSelect && onToggleSelect(data, index, e ? e.shiftKey : false)}
          onCopy={handleCopy}
          onMaximize={() => window.dispatchEvent(new CustomEvent('open-lightbox', { detail: data }))}
          onManageTags={() => window.dispatchEvent(new CustomEvent('open-tag-modal', { detail: data }))}
        />
        {menuData.open && (
          <ContextMenu
            isOpen={menuData.open}
            setIsOpen={(val) => setMenuData(prev => ({ ...prev, open: val }))}
            x={menuData.x}
            y={menuData.y}
            onAction={handleAction}
            kind={data.kind}
          />
        )}
      </div>
    </div>
  );
}