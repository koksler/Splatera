import React from 'react';
import { Copy, Maximize } from 'lucide-react';
import Button from './button';
import Label from './label';
import Radio from './radio';
import './cardPopup.css';

export default function CardPopup({
  title,
  dateText,
  tags = [],
  isSelected = false,
  onToggleSelect,
  onCopy,
  onMaximize,
  onManageTags,
}) {
  const visibleTags = tags.slice(0, 1);
  const hiddenTagsCount = tags.length - 1;

  const displayTitle = typeof title === 'string' && title.length > 50
    ? title.slice(0, 50) + '...'
    : title;

  return (
    <div className="splatera-card-popup">
      <Radio
        checked={isSelected}
        onClick={(e) => {
          e.stopPropagation();
          if (onToggleSelect) onToggleSelect(e);
        }}
      />

      <div className="popup-info">
        <span className="popup-title">{displayTitle}</span>
        <span className="popup-date">{dateText}</span>
      </div>

      <div className="popup-actions">
        {/* Wrap tags in a clickable container */}
        <div 
          onClick={(e) => {
            e.stopPropagation();
            if (onManageTags) onManageTags(e);
          }} 
          style={{ display: 'flex', gap: '5px', cursor: 'pointer' }}
          title="Click to manage tags"
        >
          {visibleTags.map((tag, index) => (
            <Label key={index} text={tag} isActive={true} /> 
          ))}

          {hiddenTagsCount > 0 && (
            <Label text={`+${hiddenTagsCount}`} isActive={true} />
          )}
        </div>

        <div className="popup-action-buttons">
          <Button icon={Copy} onClick={onCopy} tooltip="Copy" tooltipPosition="bottom" />
          <Button icon={Maximize} onClick={onMaximize} tooltip="Open Lightbox" tooltipPosition="bottom" />
        </div>
      </div>
    </div>
  );
}