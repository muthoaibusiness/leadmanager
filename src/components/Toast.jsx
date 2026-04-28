import { useEffect, useRef, useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    setCurrent(toast);
    setVisible(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(timerRef.current);
  }, [toast]);

  if (!current) return null;

  const ico = { ok: 'check_circle', err: 'error', warn: 'warning' };

  return (
    <div className={`toast${current.type ? ' ' + current.type : ''}${visible ? ' on' : ''}`}>
      <Mi>{ico[current.type] || 'info'}</Mi>
      {current.msg}
    </div>
  );
}
