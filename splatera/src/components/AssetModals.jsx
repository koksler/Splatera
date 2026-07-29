import React, { useState, useEffect } from 'react';
import { X, Plus, Rabbit, Download, CloudUpload } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Toggle from './toggle';
import Button from './button';
import TextField from './textField';
import TextBox from './TextBox';
import Label from './label';
import AssetSquare from './AssetSquare';
import './AssetModals.css';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov'];
const TEXT_EXTS = ['.txt', '.md', '.js', '.py', '.rs', '.css', '.html', '.json'];

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.replace('.', '').toLowerCase()] || 'text';
};

const getAutoTags = (path) => {
  if (typeof path !== 'string') return [];
  const parts = path.split(/[/\\]/);
  const folder = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : '';
  return folder ? [folder] : [];
};

export default function AssetModals({
  mode = 'import', // 'import' | 'edit-tags'
  assets = [],
  hasTemp = false,
  tagData = null,
  onConfirm,
  onSave,
  onClose,
}) {
  const isImportMode = mode === 'import';
  const isEditMode = mode === 'edit-tags';

  // Import mode state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmedImportItems, setConfirmedImportItems] = useState([]);
  const [saveLocally, setSaveLocally] = useState(hasTemp);

  // Asset detail state
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [renameInput, setRenameInput] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewCode, setPreviewCode] = useState('');
  const [previewExt, setPreviewExt] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  // Current item info
  const currentItem = isImportMode
    ? assets[currentIndex]
    : tagData;

  const currentPath = typeof currentItem === 'string' ? currentItem : currentItem?.path;
  const isMultipleImport = isImportMode && assets.length > 1;

  // Remaining assets for import thumbnails
  const remainingAssets = isImportMode ? assets.slice(currentIndex + 1) : [];

  // Global ESC key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setTagInput('');
    setRenameInput('');
    setPreviewUrl('');
    setPreviewCode('');
    setIsVideo(false);

    if (isImportMode && currentPath) {
      setTags(getAutoTags(currentPath));
      const ext = currentPath.slice(currentPath.lastIndexOf('.')).toLowerCase();
      setPreviewExt(ext);

      if (IMAGE_EXTS.includes(ext)) {
        setPreviewUrl(convertFileSrc(currentPath));
      } else if (VIDEO_EXTS.includes(ext)) {
        setPreviewUrl(convertFileSrc(currentPath));
        setIsVideo(true);
      } else if (TEXT_EXTS.includes(ext)) {
        invoke('read_full_text_file', { path: currentPath })
          .then((text) => setPreviewCode(text.split('\n').slice(0, 25).join('\n')))
          .catch(console.error);
      }
    } else if (isEditMode && tagData) {
      setTags(tagData.tags || tagData.currentTags || []);

      const targetAsset = tagData.isBatch && tagData.assets && tagData.assets.length > 0
        ? tagData.assets[0]
        : tagData;

      if (targetAsset) {
        const isCodeOrText = targetAsset.kind === 'Code' || targetAsset.kind === 'Text';
        const ext = targetAsset.name ? targetAsset.name.split('.').pop().toLowerCase() : '';
        const isVid = targetAsset.kind === 'Video' || VIDEO_EXTS.includes(`.${ext}`);
        setPreviewExt(ext);
        setIsVideo(isVid);

        const mediaUrl = targetAsset.preview || (targetAsset.path ? convertFileSrc(targetAsset.path) : '');

        if (!isCodeOrText && mediaUrl) {
          setPreviewUrl(mediaUrl);
        } else if (isCodeOrText) {
          if (targetAsset.contentSnippet) {
            setPreviewCode(targetAsset.contentSnippet);
          } else if (targetAsset.path) {
            invoke('read_full_text_file', { path: targetAsset.path })
              .then((text) => setPreviewCode(text.split('\n').slice(0, 25).join('\n')))
              .catch(console.error);
          }
        }
      }
    }
  }, [currentIndex, currentItem, mode, tagData]);

  // Add tag handler
  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const newTags = tagInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    setTags((prev) => [...new Set([...prev, ...newTags])]);
    setTagInput('');
  };

  // Remove tag handler
  const handleRemoveTag = (tagToRemove) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  // Advance to next asset in import batch
  const advanceImport = (nextConfirmed) => {
    if (currentIndex >= assets.length - 1) {
      if (onConfirm) onConfirm(nextConfirmed, saveLocally);
    } else {
      setConfirmedImportItems(nextConfirmed);
      setCurrentIndex((i) => i + 1);
    }
  };

  // Import Action Handlers
  const handleImportOnlyThis = () => {
    advanceImport([...confirmedImportItems, { path: currentPath, tags, batchName: renameInput }]);
  };

  const handleSkip = () => {
    if (currentIndex >= assets.length - 1 && confirmedImportItems.length === 0) {
      if (onClose) onClose();
    } else {
      advanceImport(confirmedImportItems);
    }
  };

  const handleImportAll = () => {
    const remaining = assets.slice(currentIndex).map((path) => {
      const itemPath = typeof path === 'string' ? path : path?.path;
      const auto = getAutoTags(itemPath);
      const combinedTags = [...new Set([...auto, ...tags])];
      return {
        path: itemPath,
        tags: combinedTags,
        batchName: renameInput,
      };
    });
    if (onConfirm) onConfirm([...confirmedImportItems, ...remaining], saveLocally);
  };

  const handleConfirmEditTags = () => {
    if (onSave && tagData) {
      onSave(tagData, tags);
    }
  };

  // Dynamic Header Title
  const getHeaderTitle = () => {
    if (isEditMode) {
      if (tagData?.isBatch && tagData?.assets?.length) {
        return `Editing tags for ${tagData.assets.length} assets`;
      }
      return "Here’s all the tags, let’s edit them";
    }
    if (assets.length > 1) return `Importing ${assets.length} assets`;
    return "Importing 1 asset";
  };

  return (
    <div className="asset-modal-overlay" onMouseDown={onClose}>
      <div className="asset-modal-container" onMouseDown={(e) => e.stopPropagation()}>
        {/* 1. Header Title */}
        <div className="asset-modal-title">{getHeaderTitle()}</div>

        {/* 2. Middle Body Layout */}
        <div className="asset-modal-body">
          {/* Left Column */}
          <div className="asset-modal-left">
            <div className="asset-modal-main-preview">
              {previewUrl && !isVideo && (
                <img src={previewUrl} alt="preview" className="asset-modal-media-img" />
              )}
              {previewUrl && isVideo && (
                <video
                  src={previewUrl}
                  className="asset-modal-media-img"
                  muted
                  autoPlay
                  loop
                  playsInline
                />
              )}
              {previewCode && (
                <SyntaxHighlighter
                  language={getLanguage(previewExt)}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: '12px',
                    background: 'transparent',
                    fontSize: '11px',
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                  }}
                  wrapLongLines
                >
                  {previewCode}
                </SyntaxHighlighter>
              )}
              {!previewUrl && !previewCode && (
                <span style={{ color: 'var(--color-text-button)', fontSize: '12px' }}>
                  No preview available
                </span>
              )}
            </div>

            {/* Thumbnails Row (when multiple assets in import mode or batch edit mode) */}
            {((isImportMode && isMultipleImport) || (isEditMode && tagData?.isBatch && tagData?.assets?.length > 1)) && (
              <div className="asset-modal-thumbs-row">
                {(isImportMode ? remainingAssets : tagData.assets.slice(1)).slice(0, 3).map((item, idx) => {
                  const itemPath = typeof item === 'string' ? item : item?.path;
                  const itemPreview = item?.preview || (itemPath ? convertFileSrc(itemPath) : '');
                  const ext = item?.name ? item.name.split('.').pop().toLowerCase() : (itemPath?.slice(itemPath.lastIndexOf('.')).toLowerCase().replace('.', '') || '');
                  const isVid = item?.kind === 'Video' || VIDEO_EXTS.includes(`.${ext}`);

                  return (
                    <AssetSquare
                      key={idx}
                      src={itemPreview}
                      isVideo={isVid}
                    />
                  );
                })}

                {(isImportMode ? remainingAssets : tagData.assets.slice(1)).length > 3 && (
                  <AssetSquare
                    isBlob
                    blobCount={(isImportMode ? remainingAssets : tagData.assets.slice(1)).length - 3}
                  />
                )}
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="asset-modal-right">
            {/* Save locally toggle (Import mode only) */}
            {isImportMode && (
              <div className="asset-modal-toggle-row">
                <Toggle checked={saveLocally} onChange={setSaveLocally} disabled={hasTemp} />
                <span>Save locally</span>
              </div>
            )}

            {/* TextBox for Tags */}
            <TextBox style={{ flex: 1 }}>
              {tags.map((t, idx) => (
                <Label
                  key={idx}
                  text={t}
                  editable={true}
                  onRemove={() => handleRemoveTag(t)}
                />
              ))}
            </TextBox>

            {/* Rename Input (Import mode only) */}
            {isImportMode && (
              <TextField
                placeholder="Rename (Optional)"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
              />
            )}

            {/* Add Tag Row */}
            <div className="asset-modal-tag-input-row">
              <TextField
                placeholder="Type a tag name"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              />
              <Button icon={Plus} onClick={handleAddTag} />
            </div>
          </div>
        </div>

        {/* 4. Footer Action Buttons */}
        <div className="asset-modal-footer">
          {/* Multiple Assets Import Buttons */}
          {isImportMode && isMultipleImport && (
            <>
              <Button icon={X} onClick={onClose} tooltip="Close" />
              <Button
                icon={Rabbit}
                text="Skip"
                onClick={handleSkip}
                className="asset-modal-btn-skip"
              />
              <Button
                icon={Download}
                text="Import only this"
                onClick={handleImportOnlyThis}
                className="asset-modal-btn-flex"
              />
              <Button
                icon={Download}
                text="Import All"
                onClick={handleImportAll}
                className="asset-modal-btn-flex"
              />
            </>
          )}

          {/* Single Asset Import Buttons */}
          {isImportMode && !isMultipleImport && (
            <>
              <Button
                icon={X}
                text="Close"
                onClick={onClose}
                className="asset-modal-btn-flex"
              />
              <Button
                icon={Download}
                text="Import"
                onClick={handleImportOnlyThis}
                className="asset-modal-btn-flex"
              />
            </>
          )}

          {/* Edit Tags Buttons */}
          {isEditMode && (
            <>
              <Button
                icon={X}
                text="Close"
                onClick={onClose}
                className="asset-modal-btn-flex"
              />
              <Button
                icon={CloudUpload}
                text="Confirm"
                onClick={handleConfirmEditTags}
                className="asset-modal-btn-flex"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
