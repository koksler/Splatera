import { useState } from 'react';
import { Settings, DatabaseZap } from 'lucide-react';
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
import './settingsMenu.css';

export default function SettingsMenu({ onDbUpdated, viewMode, setViewMode }) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware:[
      offset(10),
      flip(),
      shift({ padding: 10 }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const handleRecalculate = async () => {
    try {
      await invoke('recalculate_db'); 
      window.dispatchEvent(new CustomEvent('reload-library'));
      window.dispatchEvent(new CustomEvent('show-notification', {
        detail: { title: 'Database Optimized', desc: 'Library reloaded successfully.' }
      }));
      setIsOpen(false);
    } catch (error) {
      console.error("Ошибка при пересчете БД:", error);
    }
  };



  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} style={{ display: 'flex' }}>
        <Button icon={Settings} className="control-btn" tooltip="Settings" tooltipPosition="bottom" />
      </div>

      {isOpen && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="settings-popover"
          >
            <div className="settings-label">App Settings</div>
            
            <Button 
              icon={DatabaseZap} 
              text="Recalculate DB" 
              onClick={handleRecalculate}
              className="settings-action-btn"
            />



            <Button 
              text={viewMode === 'grid' ? "Switch to Horizontal View" : "Switch to Vertical View"} 
              onClick={() => {
                setViewMode(viewMode === 'grid' ? 'horizontal' : 'grid');
                handleRecalculate();
                setIsOpen(false);
              }}
              className="settings-action-btn"
            />
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}