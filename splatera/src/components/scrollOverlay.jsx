import React, { useEffect, useRef, useState } from 'react';
import './scrollOverlay.css';

export default function ScrollOverlay() {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollYRef = useRef(0);

  useEffect(() => {
    let ticking = false;

    const updatePosition = () => {
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (!track || !thumb) return;

      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const scrollY = window.scrollY;

      if (scrollHeight <= clientHeight + 5) {
        thumb.style.display = 'none';
        return;
      }

      thumb.style.display = 'block';
      const trackHeight = track.clientHeight;
      const computedThumbHeight = Math.max(30, (clientHeight / scrollHeight) * trackHeight);
      const maxThumbTop = trackHeight - computedThumbHeight;
      const maxScrollY = scrollHeight - clientHeight;
      const computedThumbTop = maxScrollY > 0 ? (scrollY / maxScrollY) * maxThumbTop : 0;

      thumb.style.height = `${computedThumbHeight}px`;
      thumb.style.transform = `translate3d(0, ${computedThumbTop}px, 0)`;
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updatePosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    updatePosition();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollYRef.current = window.scrollY;

    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    const trackHeight = track.clientHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    const computedThumbHeight = Math.max(30, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = trackHeight - computedThumbHeight;
    const maxScrollY = scrollHeight - clientHeight;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - dragStartYRef.current;
      const deltaScroll = (deltaY / maxThumbTop) * maxScrollY;
      window.scrollTo({
        top: dragStartScrollYRef.current + deltaScroll,
        behavior: 'instant'
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className={`scroll-overlay-container ${isDragging ? 'is-dragging' : ''}`}>
      <div className="scroll-overlay-track" ref={trackRef}>
        <div
          className="scroll-overlay-thumb"
          ref={thumbRef}
          onMouseDown={handleMouseDown}
        />
      </div>
    </div>
  );
}
