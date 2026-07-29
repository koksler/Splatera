import React, { useState, useEffect, useRef } from 'react';
import { X, Tag, Trash2 } from 'lucide-react';
import Button from './button';
import AssetSquare from './AssetSquare';
import './HelpDock.css';

export default function HelpDock({
  selectedAssets = [],
  onUnselectAsset,
  onClearSelection,
  onBatchTag,
  onBatchDelete,
}) {
  const [currentLayer, setCurrentLayer] = useState(0);
  const containerRef = useRef(null);
  const totalLayers = Math.ceil(selectedAssets.length / 7);

  // Reset or clamp current layer if selectedAssets count changes
  useEffect(() => {
    if (totalLayers === 0) {
      setCurrentLayer(0);
    } else if (currentLayer >= totalLayers) {
      setCurrentLayer(Math.max(0, totalLayers - 1));
    }
  }, [selectedAssets.length, totalLayers, currentLayer]);

  // Prevent page scroll when hovering/scrolling over HelpDock
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleNativeWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (totalLayers <= 1) return;
      if (e.deltaY > 0) {
        setCurrentLayer((prev) => (prev < totalLayers - 1 ? prev + 1 : prev));
      } else if (e.deltaY < 0) {
        setCurrentLayer((prev) => (prev > 0 ? prev - 1 : prev));
      }
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [totalLayers]);

  if (!selectedAssets || selectedAssets.length === 0) return null;

  const startIndex = currentLayer * 7;
  const currentAssets = selectedAssets.slice(startIndex, startIndex + 7);

  const handleCancelClick = () => {
    if (onClearSelection) onClearSelection();
  };

  const handleTagClick = () => {
    if (onBatchTag) onBatchTag(selectedAssets);
  };

  const handleDeleteClick = () => {
    if (onBatchDelete) onBatchDelete(selectedAssets);
  };

  return (
    <div className="help-dock-container" ref={containerRef}>
      {/* Header Container (top/behind) */}
      <div className="help-dock-header">
        <div className="help-dock-thumbnails">
          {currentAssets.map((asset) => {
            const ext = asset.name ? asset.name.split('.').pop().toLowerCase() : '';
            const isVideo = asset.kind === 'Video' || ext === 'mp4' || ext === 'webm' || ext === 'mov';
            return (
              <AssetSquare
                key={asset.id}
                src={asset.preview || asset.path}
                isVideo={isVideo}
                onClose={() => onUnselectAsset && onUnselectAsset(asset.id)}
              />
            );
          })}
        </div>

        {/* Custom Staged Vertical Scrollbar */}
        {totalLayers > 1 && (
          <div className="help-dock-scrollbar">
            <div className="help-dock-scrollbar-stick" />
            <div className="help-dock-scrollbar-dots">
              {currentLayer > 0 && (
                <button
                  type="button"
                  aria-label="Previous layer"
                  className="help-dock-dot prev-dot"
                  onClick={() => setCurrentLayer((prev) => prev - 1)}
                />
              )}
              <div className="help-dock-dot current-dot" />
              {currentLayer < totalLayers - 1 && (
                <button
                  type="button"
                  aria-label="Next layer"
                  className="help-dock-dot next-dot"
                  onClick={() => setCurrentLayer((prev) => prev + 1)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Container (bottom/front) */}
      <div className="help-dock-footer">
        <span className="help-dock-selected-text">
          {selectedAssets.length} file{selectedAssets.length === 1 ? '' : 's'} selected
        </span>

        <div className="help-dock-actions">
          <Button
            icon={X}
            text="Cancel"
            onClick={handleCancelClick}
          />
          <Button
            icon={Tag}
            onClick={handleTagClick}
          />
          <Button
            icon={Trash2}
            onClick={handleDeleteClick}
          />
        </div>
      </div>
    </div>
  );
}
