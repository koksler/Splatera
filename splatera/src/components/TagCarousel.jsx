import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import TagPic from './TagPic';
import ContextMenu from './contextMenu';
import ConfirmationModal from './confirmationModal';
import { invoke } from '@tauri-apps/api/core';
import './TagCarousel.css';

const SIZE_BIG = 450;
const SIZE_MID = 300;
const SIZE_SMALL = 150;
const GAP = 10;

export default function TagCarousel({ tags, onTagClick, isMinimal }) {
  const count = tags.length;
  const containerRef = useRef(null);

  // We repeat the tags list 7 times to allow a wide margin of infinite scrolling
  const repeatedTags = useMemo(() => {
    if (count === 0) return [];
    return [...tags, ...tags, ...tags, ...tags, ...tags, ...tags, ...tags];
  }, [tags, count]);

  // targetIndex is the snapped card at Slot 0
  const [targetIndex, setTargetIndex] = useState(3 * count);
  const targetIndexRef = useRef(3 * count);

  const updateTargetIndex = (newIndex) => {
    targetIndexRef.current = newIndex;
    setTargetIndex(newIndex);
  };

  useEffect(() => {
    targetIndexRef.current = 3 * count;
    setTargetIndex(3 * count);
  }, [count]);

  const oneCopyWidth = useMemo(() => {
    let width = 0;
    for (let i = 0; i < count; i++) {
      let cardWidth = SIZE_SMALL;
      if (!isMinimal && tags[i]) {
        if (tags[i].count > 200) cardWidth = SIZE_BIG;
        else if (tags[i].count > 100) cardWidth = SIZE_MID;
      }
      width += cardWidth + GAP;
    }
    return width;
  }, [tags, count, isMinimal]);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScrollLeft = useRef(0);
  const dragVelocity = useRef(0);
  const lastDragTime = useRef(0);
  const lastDragX = useRef(0);
  const hasDraggedRef = useRef(false);

  // Wheel accumulation
  const wheelAccumulator = useRef(0);
  const wheelTimeout = useRef(null);

  // Context Menu and Modal State
  const [menuData, setMenuData] = useState({ open: false, x: 0, y: 0, tag: null, count: 0 });
  const [modalMode, setModalMode] = useState(null); // null | 'delete_only_tag' | 'delete_tag_assets'

  // Smooth scroll LERP animation loop
  useEffect(() => {
    if (count === 0) return;
    let animationFrameId;

    const step = () => {
      const container = containerRef.current;
      if (!container) {
        animationFrameId = requestAnimationFrame(step);
        return;
      }

      // Continuous infinite wrap check (works during drag, wheel, and LERP!)
      const currentScrollLeft = container.scrollLeft;
      if (currentScrollLeft < 2 * oneCopyWidth) {
        container.scrollLeft += oneCopyWidth;
        if (isDragging.current) {
          dragStartScrollLeft.current += oneCopyWidth;
        }
        updateTargetIndex(targetIndexRef.current + count);
      } else if (currentScrollLeft >= 4 * oneCopyWidth) {
        container.scrollLeft -= oneCopyWidth;
        if (isDragging.current) {
          dragStartScrollLeft.current -= oneCopyWidth;
        }
        updateTargetIndex(targetIndexRef.current - count);
      }

      // If the user is dragging, do not run the snapping LERP
      if (isDragging.current) {
        animationFrameId = requestAnimationFrame(step);
        return;
      }

      const targetCard = container.querySelector(`.tag-pic-wrapper[data-index="${targetIndexRef.current}"]`);
      if (targetCard) {
        const targetScrollLeft = targetCard.offsetLeft;
        const currentScrollLeft = container.scrollLeft;
        const diff = targetScrollLeft - currentScrollLeft;

        if (Math.abs(diff) > 0.5) {
          container.scrollLeft += diff * 0.22; // Snappy LERP snapped speed
        } else {
          container.scrollLeft = targetScrollLeft;
        }
      }

      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [count, oneCopyWidth]);

  // Initial scroll position alignment
  useEffect(() => {
    const container = containerRef.current;
    if (!container || count === 0) return;

    // Wait a brief tick for the DOM layout to settle and calculate offsets correctly
    const timer = setTimeout(() => {
      const targetCard = container.querySelector(`.tag-pic-wrapper[data-index="${targetIndexRef.current}"]`);
      if (targetCard) {
        container.scrollLeft = targetCard.offsetLeft;
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [count]);

  const advance = useCallback((delta) => {
    if (count === 0) return;
    let next = targetIndexRef.current + delta;
    if (next < 0) next = 0;
    if (next >= repeatedTags.length) next = repeatedTags.length - 1;
    updateTargetIndex(next);
  }, [count, repeatedTags.length]);

  // Wheel scrolling (1 card increment per notch)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    wheelAccumulator.current += e.deltaY;
    const threshold = 50;

    if (Math.abs(wheelAccumulator.current) >= threshold) {
      const steps = Math.sign(wheelAccumulator.current);
      wheelAccumulator.current = 0;
      advance(steps);
    }

    if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
    wheelTimeout.current = setTimeout(() => {
      wheelAccumulator.current = 0;
    }, 150);
  }, [advance]);

  // Find the closest card wrapper index based on container's current scrollLeft
  const findNearestCardIndex = useCallback(() => {
    const container = containerRef.current;
    if (!container) return targetIndexRef.current;

    const cards = container.querySelectorAll('.tag-pic-wrapper');
    let nearestIndex = targetIndexRef.current;
    let minDistance = Infinity;

    cards.forEach((card) => {
      const idx = parseInt(card.getAttribute('data-index'), 10);
      const distance = Math.abs(card.offsetLeft - container.scrollLeft);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = idx;
      }
    });

    return nearestIndex;
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e) => {
    const container = containerRef.current;
    if (!container) return;

    isDragging.current = true;
    dragStartX.current = e.clientX;
    lastDragX.current = e.clientX;
    lastDragTime.current = performance.now();
    dragStartScrollLeft.current = container.scrollLeft;
    dragVelocity.current = 0;
    hasDraggedRef.current = false;

    container.classList.add('is-dragging');
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return;
    const container = containerRef.current;
    if (!container) return;

    const deltaX = e.clientX - dragStartX.current;
    const now = performance.now();
    const timeDelta = now - lastDragTime.current;

    if (timeDelta > 0) {
      const distanceMoved = e.clientX - lastDragX.current;
      dragVelocity.current = -distanceMoved / timeDelta;
    }

    if (Math.abs(deltaX) > 5) {
      hasDraggedRef.current = true;
    }

    lastDragX.current = e.clientX;
    lastDragTime.current = now;

    container.scrollLeft = dragStartScrollLeft.current - deltaX;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const container = containerRef.current;
    if (container) {
      container.classList.remove('is-dragging');
    }

    // Determine the snap index based on scroll position plus release velocity
    const nearestIndex = findNearestCardIndex();
    const velocity = dragVelocity.current;

    let inertiaDelta = 0;
    if (Math.abs(velocity) > 0.4) {
      // Swipe/flick detected, advance by 1 or 2 slots in the scroll direction
      inertiaDelta = Math.sign(velocity) * (Math.abs(velocity) > 1.2 ? 2 : 1);
    }

    let finalIndex = nearestIndex + inertiaDelta;
    if (finalIndex < 0) finalIndex = 0;
    if (finalIndex >= repeatedTags.length) finalIndex = repeatedTags.length - 1;

    updateTargetIndex(finalIndex);
  }, [findNearestCardIndex, repeatedTags.length]);

  // Attach wheel event listener natively to guarantee non-passive prevention
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Attach global mouse listeners for drag release/move outside component
  useEffect(() => {
    const handleGlobalMove = (e) => handleMouseMove(e);
    const handleGlobalUp = () => handleMouseUp();
    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleContextMenu = (e, tagData) => {
    e.preventDefault();
    if (hasDraggedRef.current) return;
    setMenuData({
      open: true,
      x: e.clientX,
      y: e.clientY,
      tag: tagData.tag,
      count: tagData.count,
    });
  };

  const handleMenuAction = (action) => {
    setMenuData((prev) => ({ ...prev, open: false }));
    if (action === 'filter') {
      onTagClick(menuData.tag);
    } else if (action === 'delete_only_tag') {
      setModalMode('delete_only_tag');
    } else if (action === 'delete_tag_assets') {
      setModalMode('delete_tag_assets');
    }
  };

  const handleDeleteTagAndAssets = async () => {
    setModalMode(null);
    try {
      await invoke('delete_tag_and_assets', { tag: menuData.tag });
      window.dispatchEvent(new CustomEvent('reload-library'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: {
          title: 'Tag & Assets Deleted',
          desc: `Successfully removed tag "${menuData.tag}" and all its assets.`,
        }
      }));
    } catch (err) {
      console.error(err);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: {
          title: 'Deletion Failed',
          desc: `Failed to delete tag and assets: ${err}`,
        }
      }));
    }
  };

  const handleDeleteOnlyTag = async () => {
    setModalMode(null);
    try {
      await invoke('delete_tag_globally', { tag: menuData.tag });
      window.dispatchEvent(new CustomEvent('reload-library'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: {
          title: 'Tag Deleted',
          desc: `Successfully removed tag "${menuData.tag}" from all assets.`,
        }
      }));
    } catch (err) {
      console.error(err);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: {
          title: 'Deletion Failed',
          desc: `Failed to delete tag: ${err}`,
        }
      }));
    }
  };

  if (count === 0) return null;

  return (
    <div className="tag-carousel-wrapper">
      <div
        className="tag-carousel-container"
        ref={containerRef}
        onMouseDown={handleMouseDown}
      >
        <div className="tag-carousel-track">
          {repeatedTags.map((tagData, i) => {
            // Size depends entirely on count of assets with tag
            let width = SIZE_SMALL;
            if (!isMinimal) {
              if (tagData.count > 200) width = SIZE_BIG;
              else if (tagData.count > 100) width = SIZE_MID;
            }

            return (
              <div
                key={`${tagData.tag}-${i}`}
                className="tag-pic-wrapper"
                data-index={i}
                style={{ width: `${width}px` }}
                onContextMenu={(e) => handleContextMenu(e, tagData)}
              >
                <TagPic
                  tag={tagData.tag}
                  count={tagData.count}
                  previewPath={tagData.preview_path}
                  width={width}
                  onClick={(tag) => {
                    if (!hasDraggedRef.current) {
                      onTagClick(tag);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ContextMenu
        isOpen={menuData.open}
        setIsOpen={(val) => setMenuData(prev => ({ ...prev, open: val }))}
        x={menuData.x}
        y={menuData.y}
        onAction={handleMenuAction}
        mode="tag"
      />

      <ConfirmationModal
        isOpen={modalMode !== null}
        title="Are you sure?"
        description={
          modalMode === 'delete_only_tag' ? (
            <span>
              This action will <span className="text-red">remove the tag "{menuData.tag}" globally from all assets.</span> The files themselves will not be deleted.
            </span>
          ) : (
            <span>
              This action will <span className="text-red">remove {menuData.count} asset{menuData.count === 1 ? '' : 's'} from the library, along with a tag.</span>
            </span>
          )
        }
        confirmText="Delete"
        cancelText="Cancel"
        thirdActionText={modalMode === 'delete_tag_assets' ? "Remove only tag" : undefined}
        onConfirm={modalMode === 'delete_tag_assets' ? handleDeleteTagAndAssets : handleDeleteOnlyTag}
        onCancel={() => setModalMode(null)}
        onThirdAction={modalMode === 'delete_tag_assets' ? handleDeleteOnlyTag : undefined}
      />
    </div>
  );
}
