import React, { useRef, useState } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import { ArrowRight, BookOpen, Briefcase, Building2, FileText, Mail, MapPin, Upload, User } from "lucide-react";
import { API_BASE_URL } from "../../config";
import Alert from "../ui/Alert";
import { CountrySelect, FloatInput } from "../ui/Fields";
import { btn } from "../ui/styles";
import { validatePhone } from "../../utils/validation";

// ============================================================
// JOIN AS A TUTOR – application form (used on /join-tutor)
// Posts to /api/tutor-application with the same field names as before.
// ============================================================

const TutorApplicationForm = () => {
  const formRef = useRef();
  // status: "" | "sending" | "success" | "error"
  const [status, setStatus] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [fileName, setFileName] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validatePhone(phone)) {
      setPhoneError("Please enter a valid phone number");
      return;
    }
    setPhoneError("");
    setStatus("sending");

    try {
      const res = await fetch(`${API_BASE_URL}/api/tutor-application`, {
        method: "POST",
        body: new FormData(formRef.current),
      });
      if (res.ok) {
        setStatus("success");
        formRef.current.reset();
        setPhone("");
        setFileName("");
      } else {
        setStatus("error");
      }
    } catch (error) {
      console.error("Error:", error);
      setStatus("error");
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4 lg:flex-1 lg:justify-between">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FloatInput id="ta-name" type="text" name="tutor_name" label="Full name" Icon={User} required />
        <FloatInput
          id="ta-email"
          type="email"
          name="tutor_email"
          label="Email address"
          Icon={Mail}
          required
          pattern="[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$"
          title="Please enter a valid email address"
        />
        <div className="phone-float relative sm:col-span-2 lg:col-span-1">
          <PhoneInput
            country={"in"}
            value={phone}
            onChange={(v) => {
              setPhone(v);
              setPhoneError("");
            }}
            inputProps={{ name: "tutor_phone", required: true, "aria-label": "Phone number" }}
            enableSearch={true}
            searchPlaceholder="Search country..."
            containerClass="w-full"
          />
          <span className="pointer-events-none absolute left-[60px] top-2 text-[11px] font-medium text-slate-500">Phone number</span>
          {phoneError && <p className="mt-1.5 text-sm text-red-600">{phoneError}</p>}
        </div>
        <FloatInput id="ta-city" type="text" name="city" label="City" Icon={MapPin} required />
        <FloatInput id="ta-state" type="text" name="state" label="State" Icon={Building2} required />
        <CountrySelect id="ta-country" name="country" label="Country" required className="sm:col-span-2 lg:col-span-1" />
      </div>

      <div className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:col-span-2 lg:col-span-3">Teaching profile</p>
        <FloatInput id="ta-expertise" type="text" name="expertise" label="Subjects you teach" Icon={BookOpen} required />
        <FloatInput id="ta-exp" type="number" name="experience" min="0" label="Experience (years)" Icon={Briefcase} required />

        {/* Resume upload – styled box around the native file input */}
        <label
          htmlFor="resume"
          className={`relative flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-dashed px-3 transition sm:col-span-2 lg:col-span-1 ${
            fileName ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-100/80 hover:border-brand hover:bg-brand-soft/60"
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-line">
            {fileName ? <FileText className="h-4 w-4 text-emerald-600" /> : <Upload className="h-4 w-4 text-navy" />}
          </span>
          <span className="min-w-0 leading-tight">
            <span className={`block truncate text-sm font-medium ${fileName ? "text-emerald-800" : "text-navy"}`}>
              {fileName || "Upload your resume"}
            </span>
            <span className="block text-[10px] text-slate-400">PDF, DOC or DOCX</span>
          </span>
          <input
            type="file"
            name="resume"
            id="resume"
            accept=".pdf,.doc,.docx"
            required
            onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
            className="sr-only"
          />
        </label>
      </div>

      {status === "success" && <Alert type="success">Application submitted! We'll review it and get back to you.</Alert>}
      {status === "error" && <Alert type="error">Submission failed. Please try again.</Alert>}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="order-2 text-xs text-slate-400 sm:order-1">Our academic team reviews every application personally.</p>
        <button type="submit" disabled={status === "sending"} className={btn("primary", "lg", "order-1 w-full sm:order-2 sm:w-auto sm:min-w-[260px]")}>
          {status === "sending" ? "Submitting…" : "Submit application"}
          {status !== "sending" && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
};

export default TutorApplicationForm;
