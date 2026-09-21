import type { ReactNode } from 'react'
import {
  Accordion,
  Label,
  ListBox,
  Select,
  Tooltip,
  Button,
} from '@heroui/react'
import { ChevronDown } from 'lucide-react'

/** Shared HeroUI controls, styled by the Apple theme in index.css. */
export function AppleSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select
      className="apple-select"
      value={value || '__all__'}
      onChange={(key) => onChange(key === '__all__' ? '' : String(key ?? ''))}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="apple-select-menu">
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value || '__all__'}
              id={option.value || '__all__'}
              textValue={option.label}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export function Disclosure({
  title,
  children,
  className = '',
}: {
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Accordion className={`apple-disclosure ${className}`}>
      <Accordion.Item>
        <Accordion.Heading>
          <Accordion.Trigger>
            {title}
            <Accordion.Indicator>
              <ChevronDown size={14} />
            </Accordion.Indicator>
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body>{children}</Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

export function IconButton({
  label,
  children,
  onPress,
  isDisabled = false,
}: {
  label: string
  children: ReactNode
  onPress: () => void
  isDisabled?: boolean
}) {
  return (
    <Tooltip delay={450}>
      <Button
        isIconOnly
        variant="tertiary"
        size="sm"
        aria-label={label}
        isDisabled={isDisabled}
        onPress={onPress}
      >
        {children}
      </Button>
      <Tooltip.Content className="apple-tooltip">{label}</Tooltip.Content>
    </Tooltip>
  )
}
