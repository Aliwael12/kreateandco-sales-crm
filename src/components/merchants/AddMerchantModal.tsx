import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { COL } from '@/lib/types'
import { createMerchant } from '@/lib/data'
import { logActivity } from '@/lib/data'
import { useProfile } from '@/context/auth'
import { useIndustries } from '@/hooks/useIndustries'
import { useSubcategories } from '@/hooks/useSubcategories'
import { useToast } from '@/components/ui/toast-context'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (merchantId: string) => void
}

export default function AddMerchantModal({
  open,
  onClose,
  onCreated,
}: Props) {
  const me = useProfile()
  const toast = useToast()
  const { names: industries } = useIndustries()
  const { namesFor } = useSubcategories()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    industry: 'F&B',
    subcategory: '',
    contact: '',
    contactRole: '',
    phone: '',
    email: '',
  })

  // Subcategory options for the currently-selected industry.
  const subOptions = namesFor(form.industry)

  function reset() {
    setForm({
      name: '',
      industry: 'F&B',
      subcategory: '',
      contact: '',
      contactRole: '',
      phone: '',
      email: '',
    })
    setError(null)
  }

  async function save() {
    const name = form.name.trim()
    if (!name) {
      setError('Business name required')
      return
    }
    setBusy(true)
    try {
      // Server-side dedupe — the merchants list is paginated client-side
      // now, so we can't rely on an in-memory Set. One indexed read.
      const { data: dupes } = await supabase
        .from(COL.merchants)
        .select('id')
        .eq('name_lower', name.toLowerCase())
        .limit(1)
      if (dupes && dupes.length > 0) {
        setError('A lead with this name already exists.')
        setBusy(false)
        return
      }
      const id = await createMerchant({
        name,
        industry: form.industry,
        subcategory: form.subcategory,
        contact: form.contact.trim(),
        contactRole: form.contactRole.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        createdBy: me.id,
      })
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'merchant.create',
        text: `added ${name} to the lead database`,
        refId: id,
        refKind: 'merchant',
      })
      toast.show('Lead added')
      reset()
      onCreated?.(id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add lead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add Lead"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add to Database'}
          </Button>
        </>
      }
    >
      <FormRow>
        <Field
          label="Business Name *"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          placeholder="e.g. Flippin' Burger"
        />
        <Select
          label="Industry"
          value={form.industry}
          onChange={(v) =>
            // Changing industry clears the subcategory (it belonged to the old
            // industry and may not exist under the new one).
            setForm({ ...form, industry: v, subcategory: '' })
          }
          options={industries}
        />
      </FormRow>
      {subOptions.length > 0 && (
        <FormRow>
          <OptionalSelect
            label="Subcategory"
            value={form.subcategory}
            onChange={(v) => setForm({ ...form, subcategory: v })}
            options={subOptions}
            placeholder="— none —"
          />
          <div />
        </FormRow>
      )}
      <FormRow>
        <Field
          label="Contact Name"
          value={form.contact}
          onChange={(v) => setForm({ ...form, contact: v })}
          placeholder="Full name"
        />
        <Field
          label="Phone"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
          placeholder="+20 1X XXXX XXXX"
        />
      </FormRow>
      <FormRow>
        <Field
          label="Email"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="contact@business.com"
        />
      </FormRow>
      {error && (
        <div className="rounded-lg bg-bad-light px-3 py-2 text-[12.5px] font-medium text-bad">
          {error}
        </div>
      )}
    </Modal>
  )
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border-[1.5px] border-line px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
      />
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

// Like Select but allows an explicit empty ("none") choice — used for the
// optional subcategory, which may be left blank.
function OptionalSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}
