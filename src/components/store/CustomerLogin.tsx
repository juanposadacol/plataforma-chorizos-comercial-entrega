import {
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../features/auth/AuthContext';
import { getErrorMessage } from '../../lib/errors';

export function CustomerLogin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { sendOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<'phone' | 'code' | 'success'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  const requestCode = async () => {
    setBusy(true);
    setError('');
    try {
      await sendOtp(phone);
      setStep('code');
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async () => {
    setBusy(true);
    setError('');
    try {
      await verifyOtp(phone, code);
      setStep('success');
      setTimeout(onClose, 900);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="auth-dialog" onClose={onClose} aria-labelledby="auth-title">
      <div className="dialog-shell">
        <button className="dialog-close" onClick={onClose} aria-label="Cerrar">
          <X aria-hidden="true" />
        </button>
        {step === 'phone' && (
          <>
            <span className="dialog-icon">
              <LockKeyhole aria-hidden="true" />
            </span>
            <p className="eyebrow eyebrow--wine">Acceso de cliente</p>
            <h2 id="auth-title">Consulta tus precios y pedidos</h2>
            <p>
              Te enviaremos un código de un solo uso. No guardamos PIN ni contraseña en texto plano.
            </p>
            <label>
              Celular
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="300 123 4567"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || phone.replace(/\D/g, '').length < 10}
              onClick={() => void requestCode()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />} Enviar
              código
            </button>
          </>
        )}
        {step === 'code' && (
          <>
            <button className="back-button" onClick={() => setStep('phone')}>
              <ArrowLeft /> Cambiar número
            </button>
            <span className="dialog-icon">
              <MessageSquareText aria-hidden="true" />
            </span>
            <h2 id="auth-title">Escribe el código</h2>
            <p>Revisa el SMS enviado a {phone}.</p>
            <label>
              Código de verificación
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || code.length !== 6}
              onClick={() => void submitCode()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />} Verificar
            </button>
          </>
        )}
        {step === 'success' && (
          <div className="success-message">
            <CheckCircle2 />
            <h2 id="auth-title">¡Sesión iniciada!</h2>
            <p>Actualizaremos el catálogo con tus precios.</p>
          </div>
        )}
      </div>
    </dialog>
  );
}
