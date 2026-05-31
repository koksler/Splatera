import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './tagManager.css';

const formatTag = (tag) => {
  if (!tag) return '';
  const upperCaseTags = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'txt', 'md', 'json', 'html', 'css', 'js'];
  if (upperCaseTags.includes(tag.toLowerCase())) return tag.toUpperCase();
  return tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
};

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { 
    js: 'javascript', py: 'python', rs: 'rust', 
    html: 'html', css: 'css', json: 'json', md: 'markdown' 
  };
  return map[ext.toLowerCase()] || 'text';
};

export default function TagManager({ data, onSave, onClose }) {
  const initialTags = data.tags || data.currentTags || [];
  const [tags, setTags] = useState(initialTags);
  const [inputValue, setInputValue] = useState('');

  const isCodeOrText = data.kind === 'Code' || data.kind === 'Text';
  const imgSrc = !isCodeOrText && (data.preview || (data.path ? convertFileSrc(data.path) : null));
  const ext = data.name ? data.name.split('.').pop().toUpperCase() : '';

  const handleRemoveTag = (tagToRemove) => setTags(tags.filter(t => t !== tagToRemove));

  const handleAddTags = () => {
    if (!inputValue.trim()) return;
    const newTags = inputValue
      .split(',')
      .map(t => t.trim()) // Keep raw, formatting is applied during render
      .filter(t => t.length > 0);

    const uniqueTags = [...new Set([...tags, ...newTags])];
    setTags(uniqueTags);
    setInputValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTags();
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="modal-content" onMouseDown={(e) => e.stopPropagation()}>

      {/* Preview Block */}
      {imgSrc && (
          <div className="modal-preview-wrapper">
            <img src={imgSrc} alt="preview" className="modal-preview-img" />
          </div>
        )}

      {isCodeOrText && data.contentSnippet && (
          <div 
            className="modal-preview-wrapper" 
            style={{ 
              alignItems: 'flex-start',
              overflow: 'hidden',
              backgroundColor: '#1E1E1E'
            }}
          >
            <SyntaxHighlighter
              language={getLanguage(ext)}
              style={vscDarkPlus}
              customStyle={{ 
                margin: 0, 
                padding: '15px',
                background: 'transparent', 
                fontSize: '12px',
                width: '100%',
                height: '100%',
                boxSizing: 'border-box'
              }}
              wrapLongLines={true}
            >
              {data.contentSnippet}
            </SyntaxHighlighter>
          </div>
        )}

        {/* Fallback for files without preview or code snippet */}
        {!imgSrc && !isCodeOrText && (
          <div className="modal-preview-wrapper">
            <span style={{ color: '#616161', fontFamily: 'monospace' }}>No preview</span>
          </div>
        )}
        
        <div className="modal-header">
          Here're all tags. Let's manage them.
        </div>

        <div className="tags-container">
          {tags.length === 0 && <span className="no-tags">No tags attached</span>}
          {tags.map((tag, index) => (
            <div key={index} className="tag-item">
              {/* Apply formatting */}
              <span className="tag-text">{formatTag(tag)}</span>
              <button className="tag-remove-btn" onClick={() => handleRemoveTag(tag)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="tag-input-group">
          <input
            type="text"
            placeholder="new tags (comma separated)..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button className="tag-add-btn" onClick={handleAddTags}>
            <Plus size={18} />
          </button>
        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>Cancel</button>
          <button className="modal-btn confirm" onClick={() => onSave(data.id, tags)}>Confirm</button>
        </div>

      </div>
    </div>
  );
}