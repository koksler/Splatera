import React, { useState } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  useMergeRefs,
} from '@floating-ui/react';
import './tooltip.css';

export const Tooltip = ({ 
    children, 
    content, 
    hotkey, 
    position = 'bottom' 
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: position,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ padding: 10 }),
      shift({ padding: 10 }),
    ],
  });

  const hover = useHover(context, { move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const child = React.isValidElement(children) ? children : <span>{children}</span>;
  const mergedRef = useMergeRefs([refs.setReference, (child).props?.ref]);

  return (
    <>
      {React.cloneElement(child, {
        ...getReferenceProps(child.props),
        ref: mergedRef,
      })}
      
      {isOpen && (
        <FloatingPortal>
          <div 
            ref={refs.setFloating} 
            style={{ ...floatingStyles, zIndex: 9999 }} 
            {...getFloatingProps()}
          >
            <div className="tooltip-bubble">
              <span>{content}</span>
              {hotkey && (
                <span className="tooltip-hotkey">
                  {hotkey}
                </span>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
};
