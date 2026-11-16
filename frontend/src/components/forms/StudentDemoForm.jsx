import React, { useRef, useState } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import { ArrowRight, Building2, Mail, MapPin, User } from "lucide-react";
import { API_BASE_URL } from "../../config";
import Alert from "../ui/Alert";
import { ChipGroup, CountrySelect, FloatInput } from "../ui/Fields";
import { btn } from "../ui/styles";
import { validatePhone } from "../../utils/validation";

// ============================================================
// BOOK A FREE DEMO – form (used on /book-demo)
// Posts to /api/student-demo with the same field names as before.
// ============================================================

const boardOptions = [
  "ICSE", "IGCSE", "CBSE", "GCSE", "STATE & MATRIC", "IB",
  "AUSTRALIAN", "A – LEVEL", "BRITISH", "CAMBRIDGE", "CANADIAN",
  "EDEXEL", "SINGAPORE",
];
// Chips show just the number; the submitted value stays "Grade N"
const gradeOptions = [...Array(12).keys()].map((i) => ({ value: `Grade ${i + 1}`, label: `${i + 1}` }));

const StudentDemoForm = () => {
  const formRef = useRef();
  // status: "" | "sending" | "success" | "error"
  const [status, setStatus] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validatePhone(phone)) {
      setPhoneError("Please enter a valid phone number");
      return;
    }
    setPhoneError("");
    setStatus("sending");

    try {
      const res = await fetch(`${API_BASE_URL}/api/student-demo`, {
        method: "POST",
        body: new FormData(formRef.current),
      });
      if (res.ok) {
        setStatus("success");
        formRef.current.reset();
        setPhone("");
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
        <FloatInput id="sd-name" type="text" name="name" label="Student's name" Icon={User} required />
        <FloatInput
          id="sd-email"
          type="email"
          name="email"
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
            inputProps={{ name: "mobile", required: true, "aria-label": "Phone number" }}
            enableSearch={true}
            searchPlaceholder="Search country..."
            containerClass="w-full"
          />
          <span className="pointer-events-none absolute left-[60px] top-2 text-[11px] font-medium text-slate-500">Phone number</span>
          {phoneError && <p className="mt-1.5 text-sm text-red-600">{phoneError}</p>}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-line p-4">
        <ChipGroup name="class_grade" label="Grade" options={gradeOptions} required />
        <ChipGroup name="board" label="Board" options={boardOptions} required />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FloatInput id="sd-city" type="text" name="city" label="City" Icon={MapPin} required />
        <FloatInput id="sd-state" type="text" name="state" label="State" Icon={Building2} required />
        <CountrySelect id="sd-country" name="country" label="Country" required className="sm:col-span-2 lg:col-span-1" />
      </div>

      {status === "success" && <Alert type="success">Demo booked successfully! We'll be in touch shortly.</Alert>}
      {status === "error" && <Alert type="error">Booking failed. Please try again.</Alert>}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="order-2 text-xs text-slate-400 sm:order-1">We usually reply within one working day.</p>
        <button type="submit" disabled={status === "sending"} className={btn("primary", "lg", "order-1 w-full sm:order-2 sm:w-auto sm:min-w-[260px]")}>
          {status === "sending" ? "Booking…" : "Book my free demo"}
          {status !== "sending" && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
};

export default StudentDemoForm;
