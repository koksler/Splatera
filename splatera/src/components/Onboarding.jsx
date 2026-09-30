import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FolderSearch, Minimize2, Maximize, CircleX } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { GrayBox, SettingRow } from './GrayBox';
import PropertySelect from './PropertySelect';
import SegmentedControl from './SegmentedControl';
import TextField from './textField';
import Button from './button';
import './Onboarding.css';

export default function Onboarding({
  isOpen,
  onComplete,
  onClose,
  initialStatus,
  currentTheme = 'Dark',
  onThemeChange,
  currentViewMode = 'grid',
}) {
  const [themeMode, setThemeMode] = useState(currentTheme);
  const [setupMode, setSetupMode] = useState('Portable');
  const [masonryType, setMasonryType] = useState(
    currentViewMode === 'horizontal' ? 'Horizontal' : 'Vertical'
  );
  const [libraryLocation, setLibraryLocation] = useState('');
  const [isCustomLocation, setIsCustomLocation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const appWindowRef = useRef(null);

  useEffect(() => {
    appWindowRef.current = getCurrentWindow();
  }, []);

  const handleMinimize = useCallback(() => appWindowRef.current?.minimize(), []);
  const handleToggleMaximize = useCallback(() => appWindowRef.current?.toggleMaximize(), []);
  const handleClose = useCallback(() => {
    if (onClose && !initialStatus?.needs_onboarding) {
      onClose();
    } else {
      appWindowRef.current?.close();
    }
  }, [onClose, initialStatus]);

  // Set default storage location based on setupMode and status
  useEffect(() => {
    if (!isCustomLocation) {
      if (setupMode === 'Portable') {
        setLibraryLocation(initialStatus?.default_local_portable || '');
      } else {
        setLibraryLocation(initialStatus?.default_local_standard || '');
      }
    }
  }, [setupMode, initialStatus, isCustomLocation]);

  useEffect(() => {
    if (currentTheme) {
      setThemeMode(currentTheme);
    }
  }, [currentTheme]);

  // Handle ESC key to dismiss if opened for testing
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleThemeSelect = (selectedTheme) => {
    setThemeMode(selectedTheme);
    if (onThemeChange) {
      onThemeChange(selectedTheme);
    }
  };

  const handleSetupModeSelect = (mode) => {
    setSetupMode(mode);
    if (!isCustomLocation) {
      if (mode === 'Portable') {
        setLibraryLocation(initialStatus?.default_local_portable || '');
      } else {
        setLibraryLocation(initialStatus?.default_local_standard || '');
      }
    }
  };

  const handleBrowseDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select where to store the library',
      });
      if (selected) {
        const rawPath =
          typeof selected === 'object' && selected !== null && selected.path
            ? selected.path
            : selected;
        if (rawPath) {
          setLibraryLocation(rawPath);
          setIsCustomLocation(true);
        }
      }
    } catch (err) {
      console.error('Directory selection error:', err);
    }
  };

  const handleFinishSetup = async () => {
    setIsSubmitting(true);
    try {
      await invoke('complete_onboarding', {
        payload: {
          theme_mode: themeMode,
          setup_mode: setupMode,
          masonry_type: masonryType,
          local_storage_path: libraryLocation ? libraryLocation.trim() : null,
        },
      });

      if (onComplete) {
        onComplete({
          themeMode,
          setupMode,
          masonryType,
          libraryLocation,
        });
      }
    } catch (err) {
      console.error('Failed to complete onboarding:', err);
      window.dispatchEvent(
        new CustomEvent('show-notification', {
          detail: {
            title: 'Setup Error',
            desc: String(err),
            duration: 4000,
          },
        })
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="onboarding-overlay" data-tauri-drag-region>
      <div className="onboarding-wrapper">
        {/* Component 1: Header */}
        <div className="onboarding-header" data-tauri-drag-region>
          <img
            src="/text_logo.svg"
            alt="Splatera"
            className="onboarding-logo"
            data-tauri-drag-region
          />
          <div className="window-controls">
            <Button
              icon={Minimize2}
              onClick={handleMinimize}
              className="control-btn"
              tooltip="Minimize"
              tooltipPosition="bottom"
            />
            <Button
              icon={Maximize}
              onClick={handleToggleMaximize}
              className="control-btn"
              tooltip="Maximize"
              tooltipPosition="bottom"
            />
            <Button
              icon={CircleX}
              onClick={handleClose}
              className="control-btn close-btn"
              tooltip="Close"
              tooltipPosition="bottom"
            />
          </div>
        </div>

        {/* Component 2: Main Scrollable Body */}
        <div className="onboarding-body">
          <div className="onboarding-greeting">
            <div>hi!</div>
            <div>let’s set things up</div>
          </div>

          <GrayBox>
            {/* Setting 1: Theme */}
            <SettingRow
              title="Your preffered color-scheme:"
              description="It can always be changed later and customized with CSS"
            >
              <PropertySelect
                options={['Dark', 'Light', 'System']}
                value={themeMode}
                onChange={handleThemeSelect}
                className="onboarding-select"
              />
            </SettingRow>

            {/* Setting 2: Portable vs Classic */}
            <SettingRow
              title="Portable, or a classic setup?"
              description="Portable stores library assets in same directory where executable sits. Classic stores it in the Roaming directory on system drive."
            >
              <SegmentedControl
                options={['Portable', 'Classic']}
                value={setupMode}
                onChange={handleSetupModeSelect}
                className="onboarding-segmented"
              />
            </SettingRow>

            {/* Setting 3: Masonry layout */}
            <SettingRow
              title="Preferred masonry type:"
              description="Vertical works with columns, horizontal works with rows. Can be changed later in options."
            >
              <PropertySelect
                options={['Vertical', 'Horizontal']}
                value={masonryType}
                onChange={setMasonryType}
                className="onboarding-select"
              />
            </SettingRow>

            {/* Setting 4: Library directory */}
            <SettingRow
              title="Where do we store the library?"
              description="A place for elements you want saved in app. You still can just link existing documents, without duplicates."
            >
              <div className="onboarding-path-group">
                <TextField
                  value={libraryLocation}
                  onChange={(e) => {
                    setLibraryLocation(e.target.value);
                    setIsCustomLocation(true);
                  }}
                  placeholder="Type in location"
                  className="onboarding-path-field"
                />
                <Button
                  icon={FolderSearch}
                  onClick={handleBrowseDirectory}
                  className="control-btn onboarding-browse-btn"
                  tooltip="Browse folder"
                  tooltipPosition="bottom"
                />
              </div>
            </SettingRow>
          </GrayBox>

          {/* Action Button: Continue / Finish Setup */}
          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-finish-btn"
              onClick={handleFinishSetup}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Setting up...' : 'Finish Setup'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
