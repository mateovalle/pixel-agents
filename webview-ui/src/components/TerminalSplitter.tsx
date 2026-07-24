import { useCallback, useRef } from 'react';

interface TerminalSplitterProps {
  onDrag: (deltaY: number) => void;
  onDoubleClick: () => void;
}

export function TerminalSplitter({ onDrag, onDoubleClick }: TerminalSplitterProps) {
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (draggingRef.current) {
          onDrag(ev.movementY);
        }
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [onDrag],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        height: 5,
        cursor: 'row-resize',
        background: 'var(--pixel-border)',
        flexShrink: 0,
      }}
    />
  );
}
