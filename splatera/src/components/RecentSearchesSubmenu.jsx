import React, { useRef, useCallback } from 'react';
import { Search, Tag as TagIcon, Paintbrush } from 'lucide-react';
import SearchSwatch from './SearchSwatch';
import './RecentSearchesSubmenu.css';

function RecentScrollRow({ title, emptyTitle, items = [], renderItem }) {
  const containerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const handleMouseDown = (e) => {
    const el = containerRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startScrollLeftRef.current = el.scrollLeft;
    hasDraggedRef.current = false;
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const deltaX = e.clientX - startXRef.current;
    if (Math.abs(deltaX) > 4) {
      hasDraggedRef.current = true;
    }
    el.scrollLeft = startScrollLeftRef.current - deltaX;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    const el = containerRef.current;
    if (!el) return;
    if (e.deltaY !== 0) {
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft += e.deltaY;
    }
  };

  const isEmpty = items.length === 0;

  return (
    <div className="recent-category-section">
      <div className="recent-category-title">
        {isEmpty ? emptyTitle : title}
      </div>
      {!isEmpty && (
        <div
          ref={containerRef}
          className="recent-category-row"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {items.map((item, idx) => (
            <div
              key={idx}
              className="recent-category-item-wrapper"
              onClickCapture={(e) => {
                if (hasDraggedRef.current) {
                  e.stopPropagation();
                }
              }}
            >
              {renderItem(item, idx)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecentSearchesSubmenu({
  history = { searches: [], tags: [], colors: [] },
  onSelectSearch,
  onSelectTag,
  onSelectColor,
  floatingRef,
  floatingStyles,
  getFloatingProps,
}) {
  return (
    <div
      ref={floatingRef}
      style={floatingStyles}
      {...(getFloatingProps ? getFloatingProps() : {})}
      className="recent-searches-submenu"
    >
      <RecentScrollRow
        title="Recent searches"
        emptyTitle="No recent searches"
        items={history.searches}
        renderItem={(item) => (
          <SearchSwatch
            icon={Search}
            text={item.text || ''}
            previewPath={item.previewPath}
            onClick={() => onSelectSearch && onSelectSearch(item.text)}
          />
        )}
      />

      <RecentScrollRow
        title="Recent tags"
        emptyTitle="No recent tags"
        items={history.tags}
        renderItem={(item) => (
          <SearchSwatch
            icon={TagIcon}
            text={item.tag || ''}
            previewPath={item.previewPath}
            onClick={() => onSelectTag && onSelectTag(item.tag)}
          />
        )}
      />

      <RecentScrollRow
        title="Recent colors"
        emptyTitle="No recent colors"
        items={history.colors}
        renderItem={(item) => (
          <SearchSwatch
            icon={Paintbrush}
            text={item.color || ''}
            color={item.color}
            onClick={() => onSelectColor && onSelectColor(item.color)}
          />
        )}
      />
    </div>
  );
}
