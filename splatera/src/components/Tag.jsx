import React from 'react';
import './Tag.css';

export const formatTag = (tag) => {
  if (!tag) return '';
  const upperCaseTags = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'txt', 'md', 'json', 'html', 'css', 'js'];
  if (upperCaseTags.includes(tag.toLowerCase())) return tag.toUpperCase();
  return tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
};

export default function Tag({ tag, onRemove, variant = 'input' }) {
  const handleClick = (e) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove(tag);
    }
  };

  return (
    <div 
      className={`splatera-tag tag-variant-${variant}`} 
      onClick={handleClick}
      title={`Remove tag: ${formatTag(tag)}`}
    >
      <span className="tag-label">
        {formatTag(tag)}
      </span>
      {onRemove && (
        <span className="tag-remove-cosmetic">
          ×
        </span>
      )}
    </div>
  );
}
