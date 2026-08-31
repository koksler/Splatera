import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings, DatabaseZap, Trash2, CakeSlice, Rabbit, Package } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import Button from './button';
import Toggle from './toggle';
import SelectButton from './selectButton';
import TextField from './textField';

import PropertySelect from './PropertySelect';
import SegmentedControl from './SegmentedControl';
import RangeSlider from './RangeSlider';

import { GrayBox, SettingRow } from './GrayBox';
import './settingsMenu.css';

export default function SettingsMenu({

  viewMode,
  setViewMode,
  pillHeader,
  onPillHeaderChange,
  themeMode,
  onThemeModeChange,
  rangeVal,
  onRangeValChange,
  autoplay,
  onAutoplayChange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('appearance');
  const [searchVal, setSearchVal] = useState('');

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('settings-open');
    } else {
      document.body.classList.remove('settings-open');
    }
    return () => {
      document.body.classList.remove('settings-open');
    };
  }, [isOpen]);

  const handleRecalculate = async () => {
    try {
      setIsOpen(false);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: {
          title: 'Optimizing Database...',
          desc: 'Regenerating thumbnails and verifying file integrity...',
          progress: 50,
          duration: 60000
        }
      }));

      await invoke('recalculate_db');

      window.dispatchEvent(new CustomEvent('reload-library'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { title: 'Database Optimized', desc: 'Library reloaded successfully.' }
      }));
    } catch (error) {
      console.error("Error on BD recalc:", error);
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { title: 'Optimization Failed', desc: 'Could not optimize the database.' }
      }));
    }
  };

  const handleToggleAutoplay = () => {
    onAutoplayChange(!autoplay);
  };

  const handleClearLibrary = async () => {
    try {
      await invoke('clear_library');
      window.dispatchEvent(new CustomEvent('reload-library'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { title: 'Library Cleared', desc: 'All files removed from the library.' }
      }));
      setIsOpen(false);
    } catch (error) {
      console.error("Error clearing library:", error);
    }
  };

  const allSettings = [
    {
      category: 'appearance',
      group: 'general',
      title: 'Your preferred color-scheme:',
      description: 'General tone of colors, dark and light',
      control: (
        <SegmentedControl
          options={['Light', 'Dark', 'System']}
          value={themeMode}
          onChange={onThemeModeChange}
        />
      )
    },
    {
      category: 'appearance',
      group: 'general',
      title: 'Masonry layout',
      description: 'Way your stuff is arranged',
      control: (
        <PropertySelect
          options={['Vertical', 'Horizontal']}
          value={viewMode === 'grid' ? 'Vertical' : 'Horizontal'}
          onChange={(val) => setViewMode(val === 'Vertical' ? 'grid' : 'horizontal')}
        />
      )
    },
    {
      category: 'appearance',
      group: 'general',
      title: 'Pill header style',
      description: 'If you like more floaty design, keep it on',
      control: (
        <Toggle
          checked={pillHeader}
          onChange={onPillHeaderChange}
        />
      )
    },
    {
      category: 'appearance',
      group: 'spacing',
      title: 'Assets zoom in',
      description: 'Lower value = More images squeezed in',
      control: (
        <RangeSlider
          min={1}
          max={7}
          steps={6}
          value={rangeVal}
          onChange={onRangeValChange}
          formatTooltip={(v) => `${Math.round((1 + (v - 4) * 0.1) * 100)}%`}
        />
      )
    },
    {
      category: 'appearance',
      group: 'experimental',
      title: 'Autoplay all media',
      description: 'It loops all gifs and videos forever. VERY RESOURCE INTENSIVE. And I mean it.',
      control: (
        <Toggle
          checked={autoplay}
          onChange={handleToggleAutoplay}
        />
      )
    },
    {
      category: 'data and storage',
      group: 'database tools',
      title: 'Recalculate DB',
      description: 'Optimize database layout, regenerate thumbnails, and verify integrity',
      control: (
        <Button
          icon={DatabaseZap}
          text="Recalculate DB"
          onClick={handleRecalculate}
          className="settings-action-btn"
        />
      )
    },
    {
      category: 'data and storage',
      group: 'database tools',
      title: 'Clear Library',
      description: 'Remove all files from the database (does not delete local disk files)',
      control: (
        <Button
          icon={Trash2}
          text="Remove all files"
          onClick={handleClearLibrary}
          className="settings-action-btn settings-danger-btn"
        />
      )
    }
  ];

  const groupBy = (array, key) => {
    return array.reduce((result, currentValue) => {
      (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
      return result;
    }, {});
  };

  const isSearchActive = searchVal.trim().length > 0;
  
  let groupedSections = {};
  if (isSearchActive) {
    const query = searchVal.toLowerCase();
    const filtered = allSettings.filter(item => 
      item.title.toLowerCase().includes(query) || 
      item.description.toLowerCase().includes(query)
    );
    groupedSections = groupBy(filtered, 'category');
  } else {
    const filtered = allSettings.filter(item => item.category === activeCategory);
    groupedSections = groupBy(filtered, 'group');
  }

  return (
    <>
      <div onClick={() => setIsOpen(true)} style={{ display: 'flex' }}>
        <Button icon={Settings} className="control-btn" tooltip="Settings" tooltipPosition="bottom" />
      </div>

      {isOpen && createPortal(
        <div className="settings-modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="settings-modal-content-wrapper" onClick={(e) => e.stopPropagation()}>
            
            {/* Left categories sidebar */}
            <div className="settings-sidebar">
              <div className="settings-header-group">
                <h2 className="settings-title">Settings</h2>
                <span className="settings-subtitle">v1.0.0-stable</span>
              </div>

              <TextField
                className="settings-search-box"
                placeholder="Search"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
              />

              <div className="settings-panel-divider" />

              <div className="settings-categories-list">
                <SelectButton
                  icon={CakeSlice}
                  text="appearance"
                  active={activeCategory === 'appearance'}
                  onClick={() => setActiveCategory('appearance')}
                  color="#5C2FFF"
                />

                <SelectButton
                  icon={Rabbit}
                  text="performance"
                  active={activeCategory === 'performance'}
                  onClick={() => setActiveCategory('performance')}
                  color="#1085F3"
                />

                <SelectButton
                  icon={Package}
                  text="data and storage"
                  active={activeCategory === 'data and storage'}
                  onClick={() => setActiveCategory('data and storage')}
                  color="#F38210"
                />
              </div>
            </div>

            {/* Right wide content section */}
            <div className="settings-content">
              {Object.keys(groupedSections).length === 0 ? (
                <div className="settings-category-placeholder">
                  <h3 className="settings-group-title">
                    {isSearchActive ? 'no results' : activeCategory}
                  </h3>
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginTop: '20px' }}>
                    {isSearchActive ? 'No settings match your search query.' : 'Settings section placeholder.'}
                  </div>
                </div>
              ) : (
                <div className="settings-category-content">
                  {Object.entries(groupedSections).map(([sectionTitle, items]) => (
                    <div className="settings-group" key={sectionTitle}>
                      <h3 className="settings-group-title">{sectionTitle}</h3>
                      <GrayBox>
                        {items.map((item) => (
                          <SettingRow
                            key={item.title}
                            title={item.title}
                            description={item.description}
                          >
                            {item.control}
                          </SettingRow>
                        ))}
                      </GrayBox>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}