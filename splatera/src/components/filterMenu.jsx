import { useState, useEffect, useRef } from 'react';
import { Filter } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { invoke } from '@tauri-apps/api/core';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingFocusManager,
} from '@floating-ui/react';

import Button from './button';
import TextField from './textField';
import Label from './label';
import './filterMenu.css';

export default function FilterMenu({
  pickerColor,
  setPickerColor,
  selectedTags,
  setSelectedTags,
  dateFilter,
  setDateFilter,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [suggestedTags, setSuggestedTags] = useState([]);
  const tagsRowRef = useRef(null);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => {
        const headerEl = document.querySelector('.splatera-header');
        const buttonEl = refs.reference.current;
        if (headerEl && buttonEl && headerEl.contains(buttonEl)) {
          const headerRect = headerEl.getBoundingClientRect();
          const buttonRect = buttonEl.getBoundingClientRect();
          return (headerRect.bottom - buttonRect.bottom) + 10;
        }
        return 10;
      }),
      flip(),
      shift({ padding: 12 }),
    ],
  });

  const handleTagClick = (tag) => {
    const normalized = tag.toLowerCase();
    if (!selectedTags.includes(normalized)) {
      setSelectedTags([...selectedTags, normalized]);
    }
  };

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      const trimmed = tagInput.trim().toLowerCase();
      const parts = trimmed.split(/\s+/);
      const lastWord = parts[parts.length - 1];
      if (lastWord) {
        handleTagClick(lastWord);
      }
      setTagInput('');
    }
  };

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  useEffect(() => {
    if (isOpen) {
      const loadTags = async () => {
        try {
          const tags = await invoke('get_top_tags');
          setSuggestedTags(tags);
        } catch (error) {
          console.error("Error loading tags:", error);
        }
      };
      loadTags();
    }
  }, [isOpen]);

  useEffect(() => {
    const el = tagsRowRef.current;
    if (!el) return;

    const onWheel = (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        e.stopPropagation();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isOpen, suggestedTags]);

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()}>
        <Button icon={Filter} text="Filter" />
      </div>

      {isOpen && (
        <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="filter-popover"
          >

            <div>
              <div className="filter-section-title">Suggested tags:</div>
              <div className="filter-tags-row" ref={tagsRowRef}>
                {suggestedTags.length > 0 ? (
                  suggestedTags.map(tag => (
                    <Label
                      key={tag}
                      text={tag}
                      isActive={selectedTags.includes(tag.toLowerCase())}
                      onClick={() => handleTagClick(tag)}
                    />
                  ))
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--color-text-button)' }}>
                    No tags in database
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="filter-section-title">Filter by tag</div>
              <TextField
                placeholder="Type a tag name"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
              />
            </div>

            <div>
              <div className="filter-section-title">Filter by Color</div>
              <div className="filter-color-row">
                <div style={{ flex: 1 }}>
                  <TextField
                    placeholder="Type a HEX code"
                    value={pickerColor}
                    onChange={(e) => setPickerColor(e.target.value)}
                  />
                </div>
                <div
                  className="filter-color-circle"
                  style={{ backgroundColor: pickerColor }}
                />
              </div>

              <HexColorPicker color={pickerColor} onChange={setPickerColor} />
            </div>

            {/* 4. Filter by Date */}
            <div>
              <div className="filter-section-title">Enter a Date</div>
              <TextField
                placeholder="Type a date or period"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>

          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}