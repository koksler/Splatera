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
  document.querySelectorAll('.card-video').forEach(v => {
    if (autoplayVideos) v.play().catch(() => { });
    else { v.pause(); v.currentTime = 0; }
  });
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
function Card({ data, index, onOpenLightbox }) {
  const videoRef = useRef(null);
  const hoverTimeout = useRef(null);
  const showImageTimer = useRef(null);
  const [menuData, setMenuData] = useState({ open: false, x: 0, y: 0 });
  const [showImage, setShowImage] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [autoplay, setAutoplay] = useState(autoplayVideos);

  useEffect(() => {
    const handler = (e) => setAutoplay(e.detail);
    window.addEventListener('set-autoplay-videos', handler);
    return () => window.removeEventListener('set-autoplay-videos', handler);
  }, []);

  useEffect(() => {
    if (showImageTimer.current) clearTimeout(showImageTimer.current);
    showImageTimer.current = setTimeout(() => {
      setShowImage(true);
      if (autoplayVideos && isVideo && videoRef.current) {
        videoRef.current.play().catch(() => { });
      }
    }, 80);
    return () => {
      if (showImageTimer.current) clearTimeout(showImageTimer.current);
    };
  }, [data.id]);

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
  const cardAspectRatio = data.width && data.height ? `${data.width} / ${data.height}` : '1 / 1';

  const handleMouseEnter = () => {
    setIsHovered(true);
    const isScrolling = document.querySelector('.app-container')?.classList.contains('is-scrolling');
    if (isScrolling && !autoplayVideos) return;

    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => {
      videoRef.current?.play().catch(() => { });
    }, 200);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
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
          // Optimistic: remove from UI immediately, let App handle undo
          window.dispatchEvent(new CustomEvent('optimistic-delete', { detail: { id: data.id, image: data } }));
          await invoke('delete_asset', { id: data.id });
        } catch (err) {
          console.error('Failed to delete:', err);
          // Re-add via reload if actual delete failed
          window.dispatchEvent(new CustomEvent('reload-library'));
          notify('Delete Failed', `Could not delete "${data.name}".`);
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
      onDoubleClick={handleDoubleClick}
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
        <div className="img-container" style={{ background: '#222', width: '100%', height: '100%', contain: 'layout paint' }}>
          {showImage && (
            <img
              src={(isGif && isHovered) || (isAnimatable && autoplay) ? convertFileSrc(data.path) : (data.preview || convertFileSrc(data.path))}
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