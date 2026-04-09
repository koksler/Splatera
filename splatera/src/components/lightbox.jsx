import { useEffect, useState, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Copy, Minimize2 } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Button from './button';
import Label from './label';
import './lightbox.css';

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.toLowerCase()] || 'text';
};

export default function Lightbox({ file, onClose }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  
  const [fullText, setFullText] = useState('');
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  
  const overlayRef = useRef(null);
  const imgRef = useRef(null);

  const isCodeOrText = file.kind === 'Code' || file.kind === 'Text';
  const ext = file.name ? file.name.split('.').pop().toUpperCase() : 'IMG';
  const isVideo = file.kind === 'Video' || ['MP4', 'WEBM', 'MOV'].includes(ext);

  useEffect(() => {
    if (isCodeOrText) {
      setIsLoadingCode(true);
      invoke('read_full_text_file', { path: file.path || file.original_path })
        .then(text => setFullText(text))
        .catch(err => setFullText(`Error loading file:\n${err}`))
        .finally(() => setIsLoadingCode(false));
    }
  }, [file, isCodeOrText]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    const overlay = overlayRef.current;
    if (!overlay) return;

    const handleWheelNative = (e) => {
      if (isCodeOrText) return;
      e.preventDefault();
      const zoomFactor = 0.0015; 
      const delta = -e.deltaY * zoomFactor;

      setScale((prev) => {
        const next = prev + delta;
        const newScale = Math.min(Math.max(next, 0.3), 10);
        if (newScale <= 1) setOffset({ x: 0, y: 0 });
        return newScale;
      });
    };

    overlay.addEventListener('wheel', handleWheelNative, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      overlay.removeEventListener('wheel', handleWheelNative);
    };
  }, [onClose, isCodeOrText]);

  const handleMouseDown = (e) => {
    if (isCodeOrText) return;
    if (scale <= 1) return;
    setIsPanning(true);
    setStartPos({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e) => {
    if (!isPanning || isCodeOrText) return;
    setOffset({
      x: e.clientX - startPos.x,
      y: e.clientY - startPos.y
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleBackdropClick = (e) => {
    if (e.target === overlayRef.current || e.target.classList.contains('lightbox-content')) {
      onClose();
    }
  };

  const targetPath = file.original_path || file.path;
  const originalImageUrl = convertFileSrc(targetPath);

  return (
    <div 
      className="splatera-lightbox-overlay" 
      ref={overlayRef}
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="lightbox-controls">
        <Label text={ext} isActive={true} />
        <Label text={isCodeOrText ? "Code" : isVideo ? "Video" : "Image"} isActive={true} />
        {!isCodeOrText && !isVideo && <Button icon={Copy} onClick={() => invoke('copy_image_to_clipboard', { path: file.path })} />}
        <Button icon={Minimize2} onClick={onClose} /> 
      </div>

      <div className="lightbox-content">
        {isCodeOrText ? (
          <div 
            className="lightbox-code-wrapper"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {isLoadingCode ? (
              <div style={{color: 'white', padding: '20px'}}>Loading code...</div>
            ) : (
              <SyntaxHighlighter
                language={getLanguage(ext)}
                style={vscDarkPlus}
                showLineNumbers={true}
                customStyle={{ 
                  margin: 0, 
                  padding: '20px', 
                  background: '#1e1e1e', 
                  fontSize: '14px',
                  minHeight: '100%',
                }}
              >
                {fullText}
              </SyntaxHighlighter>
            )}
          </div>
        ) : isVideo ? (
          <div className="lightbox-video-wrapper" onClick={(e) => e.stopPropagation()}>
            <video 
              src={originalImageUrl} 
              className="lightbox-video" 
              controls 
              autoPlay 
              loop
            />
          </div>
        ) : (
          <img 
            ref={imgRef}
            src={originalImageUrl} 
            alt={file.name} 
            className="lightbox-image" 
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
            style={{ 
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: isPanning ? 'none' : 'transform 0.15s ease-out',
              cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
              userSelect: 'none',
              WebkitUserDrag: 'none'
            }} 
          />
        )}
      </div>
    </div>
  );
}