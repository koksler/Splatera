import React from 'react';
import AssetModals from './AssetModals';

export default function TagManager({ data, onSave, onClose }) {
  return (
    <AssetModals
      mode="edit-tags"
      tagData={data}
      onSave={onSave}
      onClose={onClose}
    />
  );
}