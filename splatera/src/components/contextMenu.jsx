import { useLayoutEffect } from 'react';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
  useDismiss,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react';
import { Copy, Clipboard, Trash2, Edit3, ExternalLink, Tags } from 'lucide-react';
import './contextMenu.css';

export default function ContextMenu({ isOpen, setIsOpen, x, y, onAction, kind }) {
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(5), flip(), shift()],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    if (isOpen) {
      refs.setPositionReference({
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          x,
          y,
          top: y,
          left: x,
          right: x,
          bottom: y,
        }),
      });
    }
  }, [isOpen, x, y, refs]);

  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!isOpen) return null;

  const isCodeOrText = kind === 'Code' || kind === 'Text';

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="context-menu"
      >
        <div className="context-menu-item" onClick={() => onAction('copy')}>
          {isCodeOrText 
            ? <><Clipboard size={14} /> Copy Text</>
            : <><Copy size={14} /> Copy Image</>
          }
        </div>
        <div className="context-menu-item" onClick={() => onAction('open_folder')}>
          <ExternalLink size={14} /> Show in Folder
        </div>
        <div className="context-menu-item" onClick={() => onAction('add_tag')}>
          <Tags size={14} /> Manage tags
        </div>
        <div className="context-menu-item" onClick={() => onAction('rename')}>
          <Edit3 size={14} /> Rename
        </div>
        <div className="context-menu-item danger" onClick={() => onAction('delete')}>
          <Trash2 size={14} /> Delete from library
        </div>
        <div className="context-menu-item danger" onClick={() => onAction('delete_device')}>
          <Trash2 size={14} /> Delete from device
        </div>
      </div>
    </FloatingPortal>
  );
}