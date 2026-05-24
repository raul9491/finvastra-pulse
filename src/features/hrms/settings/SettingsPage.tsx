import { Mail, Phone, MessageSquare } from 'lucide-react';

export function HrmsSettingsPage() {
  return (
    <div>
      <h2 className="text-3xl mb-1"
        style={{ fontFamily: '"Fraunces", Georgia, serif', fontStyle: 'italic', fontWeight: 300, color: '#0A0A0A' }}>
        Settings
      </h2>
      <p className="mb-8 text-sm" style={{ color: '#8B8B85' }}>
        Need help? Reach out to HR directly.
      </p>

      <div className="max-w-xl space-y-4">
        {/* Contact HR card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: '#475569' }}>
            Contact HR
          </h3>

          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: '#FAFAF7' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#0B153815', color: '#0B1538' }}>
                <Mail size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#8B8B85' }}>Email</p>
                <a href="mailto:hr@finvastra.com"
                  className="text-sm font-medium hover:underline"
                  style={{ color: '#0B1538' }}>
                  hr@finvastra.com
                </a>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: '#FAFAF7' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#C9A96115', color: '#9A7E3F' }}>
                <Phone size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#8B8B85' }}>Phone / WhatsApp</p>
                <a href="tel:+919000000000"
                  className="text-sm font-medium hover:underline"
                  style={{ color: '#0B1538' }}>
                  +91 90000 00000
                </a>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: '#FAFAF7' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#10B98115', color: '#065F46' }}>
                <MessageSquare size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: '#8B8B85' }}>Admin</p>
                <a href="mailto:rahulv@finvastra.com"
                  className="text-sm font-medium hover:underline"
                  style={{ color: '#0B1538' }}>
                  rahulv@finvastra.com
                </a>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-center" style={{ color: '#8B8B85' }}>
          For urgent matters, WhatsApp is fastest. For data corrections or access issues, email is preferred.
        </p>
      </div>
    </div>
  );
}
