import { Unlink } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import CardPopup from './cardPopup';
import ContextMenu from './contextMenu';
import './card.css';

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
function Card({ data }) {
  const videoRef = useRef(null);
  const hoverTimeout = useRef(null);
  const showImageTimer = useRef(null);
  const [menuData, setMenuData] = useState({ open: false, x: 0, y: 0 });
  const [showImage, setShowImage] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // FIX: The original effect ran once on mount and checked is-scrolling at that moment.
  // After a grid re-layout (resize, compact↔maximized toggle), cards remount but
  // is-scrolling is often still set from the resize event, leaving images permanently
  // hidden until the next hover/scroll cycle.
  //
  // New approach: always start a short delay (avoids layout thrash on initial mount),
  // but cap it at 80ms — short enough that images appear immediately after resize
  // without waiting for an interaction. We no longer gate on is-scrolling here because
  // the scroll-based image deferral is already handled by the CSS opacity transition
  // on the <img> itself (opacity 0→1 on load). The is-scrolling class is only used
  // to skip video autoplay (handled in handleMouseEnter), not image visibility.
  useEffect(() => {
    if (showImageTimer.current) clearTimeout(showImageTimer.current);
    showImageTimer.current = setTimeout(() => setShowImage(true), 80);
    return () => {
      if (showImageTimer.current) clearTimeout(showImageTimer.current);
    };
  }, [data.id]); // Re-run if the card's data identity changes, but not on every render

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
  const cardAspectRatio = data.width && data.height ? `${data.width} / ${data.height}` : '1 / 1';

  const handleMouseEnter = () => {
    setIsHovered(true);
    // FIX: Only gate video autoplay on scrolling, not image visibility
    const isScrolling = document.querySelector('.app-container')?.classList.contains('is-scrolling');
    if (isScrolling) return;

    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      videoRef.current?.play().catch(() => { });
    }, 200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (videoRef.current) {
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

  const handleCopy = async () => {
    try {
      if (isCodeOrText) {
        await invoke('copy_text_to_clipboard', { path: data.path });
        notify('Text Copied', `${data.name} copied to clipboard.`);
      } else {
        await invoke('copy_image_to_clipboard', { path: data.path });
        notify('Image Copied', `${data.name} copied to clipboard.`);
      }
    } catch {
      notify('Error', 'Failed to copy.');
    }
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
          await invoke('delete_asset', { id: data.id });
          window.dispatchEvent(new CustomEvent('reload-library'));
          notify('Asset Removed', `"${data.name}" has been deleted.`);
        } catch (err) {
          console.error('Failed to delete:', err);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={`splatera-card ${isVideo ? 'is-video' : ''}`}
      style={{ aspectRatio: cardAspectRatio }}
      draggable
      onDragStart={handleDragStart}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
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
          className="card-video"
          poster={data.preview || undefined}
        />
      ) : (
        <div className="img-container" style={{ background: '#222', width: '100%', height: '100%' }}>
          {showImage && (
            <img
              src={(isGif && isHovered) ? convertFileSrc(data.path) : (data.preview || convertFileSrc(data.path))}
              alt={data.name}
              loading="lazy"
              decoding="async"
              onLoad={(e) => { e.target.style.opacity = 1; }}
              style={{ opacity: 0, transition: 'opacity 0.2s ease' }}
            />
          )}
        </div>
      )}

      <div className="popup-wrapper">
        <CardPopup
          title={displayName}
          dateText={formatDate(data.created_at)}
          tags={data.tags ?? [ext]}
          onCopy={handleCopy}
          onMaximize={() => window.dispatchEvent(new CustomEvent('open-lightbox', { detail: data }))}
          onManageTags={() => window.dispatchEvent(new CustomEvent('open-tag-modal', { detail: data }))}
        />
        <ContextMenu
          isOpen={menuData.open}
          setIsOpen={(val) => setMenuData(prev => ({ ...prev, open: val }))}
          x={menuData.x}
          y={menuData.y}
          onAction={handleAction}
          kind={data.kind}
        />
      </div>
    </div>
  );
}