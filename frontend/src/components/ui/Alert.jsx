import React from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

const Alert = ({ type = 'info', children }) => {
    const variants = {
        info: { cls: 'bg-brand-soft text-navy border-brand/30', Icon: Info },
        success: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: CheckCircle2 },
        error: { cls: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle },
    };
    const { cls, Icon } = variants[type];
    return (
        <div role="status" aria-live="polite" className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm font-medium">{children}</div>
        </div>
    );
};

export default Alert;
