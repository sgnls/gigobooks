/**
 * Copyright (c) 2020-present Beng Tan
 */

import * as React from 'react'
import { Controller, useForm, useFieldArray, ArrayField, FormContextValues as FCV } from 'react-hook-form'
import { Link, Redirect } from 'react-router-dom'
import DatePicker from 'react-datepicker'
import { TransactionOrKnex, Model,
    Project, Transaction, TransactionType, Account, Actor, IElement,
    dateFormatString as dfs, toDateOnly, parseISO, lastSavedDate,
    toFormatted, parseFormatted, taxCodeInfo, taxRate, taxCodeWithRate } from '../core'
import { validateElementAmounts, validateElementTaxAmounts } from '../util/util'
import { playSuccess, playAlert } from '../util/sound'
import { MaybeSelect, flatSelectOptions, currencySelectOptions, taxSelectOptions } from './SelectOptions'
import { formCalculateTaxes } from './form'
import InvoicePayment from './InvoicePayment'

type Props = {
    arg1?: string
}

export type FormData = {
    type: TransactionType
    actorId: number
    actorTitle?: string
    date: Date
    description?: string
    elements: {
        // `.id` is used by the form system so we have eId to store 'our' id
        eId?: number
        accountId: number
        amount: string
        currency: string
        useGross: number
        grossAmount: string
        description?: string
        taxes?: {
            eId?: number
            code: string
            rate: string
            amount: string
        }[]
    }[]
    submit?: string    // Only for displaying general submit error messages
}

export default function Sale(props: Props) {
    // argId == 0 means creating a new transaction
    const argId = /^\d+$/.test(props.arg1!) ? Number(props.arg1) : 0

    const [transaction, setTransaction] = React.useState<Transaction>()
    const [revenueOptions, setRevenueOptions] = React.useState<{}>()
    const [customerOptions, setCustomerOptions] = React.useState<{}>()
    const [actorTitleEnable, setActorTitleEnable] = React.useState<boolean>(false)
    const [redirectId, setRedirectId] = React.useState<number>(-1)
    let action = ''

    const form = useForm<FormData>()
    const {fields, append} = useFieldArray({control: form.control, name: 'elements'})

    function clearForm() {
        const currency = Project.variables.get('currency')
        form.reset({
            actorId: 0,
            date: lastSavedDate(),
            elements: [{currency}, {currency}],
        })
    }

    // Initialise a lot of stuff
    React.useEffect(() => {
        // Clear redirectId
        setRedirectId(-1)

        // Load revenue accounts
        Account.query().select()
        .whereIn('type', Account.TypeGroupInfo[Account.Revenue].types)
        .orderBy(['title'])
        .then((rows) => {
            setRevenueOptions(flatSelectOptions(rows))
        })

        // Load customers
        Actor.query().select()
        .where('type', Actor.Customer)
        .orderBy('title')
        .then((rows: any[]) => {
            rows.push({id: Actor.NewCustomer, title: '<new customer>', type: Actor.Customer})
            setCustomerOptions(flatSelectOptions(rows))
        })
        
        // Load transaction (if exists) and initialise form accordingly
        if (argId > 0) {
            Transaction.query().findById(argId).whereIn('type', [Transaction.Sale, Transaction.Invoice])
            .withGraphFetched('elements')
            .then(t => {
                setTransaction(t)
                if (t) {
                    form.reset(extractFormValues(t))
                }
            })
        }
        else {
            setTransaction(Transaction.construct({}))
            clearForm()
        }
    }, [props.arg1, transaction && transaction.updatedAt ? transaction.updatedAt.toString() : 0])

    const onSubmit = (data: FormData) => {
        if (!validateFormData(form, data)) {
            playAlert()
            return
        }

        Model.transaction(trx => saveFormData(transaction!, data, trx)).then(savedId => {
            if (savedId) {
                playSuccess()
                form.reset(extractFormValues(transaction!))
                setActorTitleEnable(false)

                if (action == '' && argId != savedId) {
                    setRedirectId(savedId)
                }
                else if (action == 'and-new') {
                    clearForm()
                    if (argId != 0) {
                        setRedirectId(0)
                    }        
                }
            }
        }).catch(e => {
            playAlert()
            form.setError('submit', '', e.toString())
        })
    }

    if (redirectId >= 0 && redirectId != argId) {
        return <Redirect to={`/sales/${redirectId ? redirectId : 'new'}`} />
    }
    else if (transaction && revenueOptions && customerOptions) {
        const saleForm = <div>
            <h1>
                <span className='breadcrumb'>
                    <Link to='/sales'>Sales</Link> » </span>
                <span className='title'>
                    {transaction.id ? `${Transaction.TypeInfo[transaction.type!].label} ${transaction.id}` : 'New sale'}
                </span>
            </h1>
            <form onSubmit={form.handleSubmit(onSubmit)} className='transaction-form'>
                <table className='horizontal-table-form transaction-fields'><tbody><tr className='row row-type'>
                    <th scope='row'>
                        <label htmlFor='type'>Type:</label>
                    </th><td>
                        <select name='type' ref={form.register} disabled={!!transaction.id}>
                            <option key={Transaction.Sale} value={Transaction.Sale}>
                                {Transaction.TypeInfo[Transaction.Sale].label}
                            </option>
                            <option key={Transaction.Invoice} value={Transaction.Invoice}>
                                {Transaction.TypeInfo[Transaction.Invoice].label}
                            </option>
                        </select>
                    </td>
                </tr><tr className='row row-actor'>
                    <th scope='row'>
                        <label htmlFor='actorId'>Customer:</label>
                    </th><td>
                        <select
                            name='actorId'
                            onChange={e => {
                                const value = Number(e.target.value)
                                setActorTitleEnable(value == Actor.NewCustomer)
                            }}
                            ref={form.register}>
                            {customerOptions}
                        </select>
                        {form.errors.actorId && <span className='error'>
                            {form.errors.actorId.message}
                        </span>}

                        {actorTitleEnable && <span className='actor-title'>
                            <label htmlFor='actorTitle'>Name:</label>
                            <input name='actorTitle' ref={form.register} />
                            {form.errors.actorTitle && <span className='error'>
                                {form.errors.actorTitle.message}
                            </span>}
                        </span>}
                    </td>
                </tr><tr className='row row-date'>
                    <th scope='row'>
                        <label htmlFor='date'>Date:</label>
                    </th><td>
                        <Controller
                            // No-op for DatePicker.onChange()
                            as={<DatePicker dateFormat={dfs()} onChange={() => {}} />}
                            control={form.control}
                            register={form.register()}
                            name='date'
                            valueName='selected'
                            onChange={([selected]) => selected}
                        />
                        {form.errors.date && <span className='error'>
                            {form.errors.date.message}
                        </span>}
                    </td>
                </tr><tr className='row row-description'>
                    <th scope='row'>
                        <label htmlFor='description'>Description:</label>
                    </th><td>
                        <input name='description' ref={form.register} />
                    </td>
                </tr></tbody></table>
                <table className='transaction-elements'><thead><tr>
                    <th rowSpan={2}>
                        Revenue type
                    </th><th rowSpan={2} colSpan={3}>
                        Description
                    </th><th scope='colgroup' colSpan={3}>
                        Amount
                    </th><td rowSpan={2}>
                        &nbsp;
                    </td>
                </tr><tr>
                    <th>
                        Currency
                    </th><th>
                        Gross
                    </th><th>
                        Net
                    </th>
                </tr></thead>
                {fields.map((item, index) =>
                    <ElementFamily
                        key={item.id}
                        currency={fields[0].currency}
                        {...{form, item, index, revenueOptions}}
                    />
                )}
                </table>
                <div className='more'>
                    <button type='button' onClick={() => append({name: 'elements'})}>
                        More rows
                    </button>
                </div><div className='errors'>
                    {form.errors.submit && <span className='error'>{form.errors.submit.message}</span>}
                </div><div className='buttons'>
                    <input type='submit' value='Save' />
                    <input type='submit' value='Save and new' onClick={() => {
                        action = 'and-new'
                    }} />
                </div>
            </form>
        </div>

        return <div>
            {saleForm}
            {!!transaction.id && transaction.type == Transaction.Invoice &&
            transaction.elements && transaction.elements.length > 0 &&
            <InvoicePayment transaction={transaction} />}
        </div>
    }

    return null
}

type ElementFamilyProps = {
    form: FCV<FormData>
    item: Partial<ArrayField<Record<string, any>, "id">>
    index: number
    currency: string
    revenueOptions: {}
}

function ElementFamily(props: ElementFamilyProps) {
    const {form, item, index, revenueOptions} = props
    const {fields, append} = useFieldArray({control: form.control, name: `elements[${index}].taxes`})

    const [formatted, setFormatted] = React.useState<string>(item.amount)
    const [grossFormatted, setGrossFormatted] = React.useState<string>(item.grossAmount)
    const [useGross, setUseGross] = React.useState<number>(item.useGross ? 1 : 0)
    const [currency, setCurrency] = React.useState<string>(props.currency)
    const [rates, setRates] = React.useState<string[]>(fields.map(subItem => subItem.rate))
    const state = {formatted, setFormatted, grossFormatted, setGrossFormatted, useGross, setUseGross, currency, setCurrency, rates, setRates}
    const [enabled, setEnabled] = React.useState<boolean>(!item.useGross || !item.grossAmount)
    const [grossEnabled, setGrossEnabled] = React.useState<boolean>(item.useGross || !item.amount)
    const [ratesEnabled, setRatesEnabled] = React.useState<boolean[]>(fields.map(subItem => taxCodeInfo(subItem.code).variable))
    const formErrors: any = form.errors

    return <tbody className='element-family'>
    <tr className={`element element-${index}`} key={item.id}><td className='account' rowSpan={65534}>
        {!!item.eId && 
        <input type='hidden' name={`elements[${index}].eId`} value={item.eId} ref={form.register()} />}
        <select
            name={`elements[${index}].accountId`}
            defaultValue={item.accountId}
            ref={form.register()}>
            {revenueOptions}
        </select>
    </td><td className='description' colSpan={3}>
        <input
            name={`elements[${index}].description`}
            defaultValue={item.description}
            ref={form.register()}
        />
    </td><td className='currency'>
        {index == 0 ?
        <MaybeSelect
            name={`elements[${index}].currency`}
            defaultValue={item.currency}
            onChange={(e: {target: {value: string}}) => {
                state.currency = e.target.value
                formCalculateTaxes(form, `elements[${index}]`, state, 'currency')
            }}
            forwardRef={form.register()}>
            {currencySelectOptions(item.currency)}
        </MaybeSelect> :
        <input
            type='hidden'
            name={`elements[${index}].currency`}
            value={currency}
            ref={form.register()}
        />}
        <input
            type='hidden'
            name={`elements[${index}].useGross`}
            value={state.useGross}
            ref={form.register()}
        />
    </td><td className='gross-amount'>
        <input
            name={`elements[${index}].grossAmount`}
            defaultValue={item.grossAmount}
            disabled={!grossEnabled}
            onChange={e => {
                state.grossFormatted = e.target.value
                state.useGross = e.target.value ? 1 : 0
                formCalculateTaxes(form, `elements[${index}]`, state, 'grossAmount')
                setEnabled(e.target.value ? false : true)
            }}
            ref={form.register()}
        />
        {form.errors.elements && form.errors.elements[index] &&
            form.errors.elements[index].grossAmount &&
            <div className='error'>{form.errors.elements[index].grossAmount!.message}</div>}
    </td><td className='amount'>
        <input
            name={`elements[${index}].amount`}
            defaultValue={item.amount}
            disabled={!enabled}
            onChange={e => {
                state.formatted = e.target.value
                formCalculateTaxes(form, `elements[${index}]`, state, 'amount')
                setGrossEnabled(e.target.value ? false : true)
            }}
            ref={form.register()}
        />
        {form.errors.elements && form.errors.elements[index] &&
            form.errors.elements[index].amount &&
            <div className='error'>{form.errors.elements[index].amount!.message}</div>}
    </td><td className='add-tax' rowSpan={65534}>
        <button type='button' onClick={() => append({name: `elements[${index}].taxes`})}>
            Add tax
        </button>
    </td></tr>

    {fields.length > 0 && <tr className='child-header' key={`${item.id}-taxes`}><td className='header-space-start' rowSpan={65534}>
        &nbsp;
    </td><th className='header-tax-code'>
        tax
    </th><th className='header-tax-rate'>
        tax rate
    </th><th className='header-space-middle' colSpan={2}>
        &nbsp;
    </th><th className='header-amount'>
        amount
    </th></tr>}

    {fields.map((subItem, subIndex) => 
    <tr className={`child child-${subIndex}${subIndex == fields.length-1 ? ' child-last' : ''}`} key={subItem.id}><td className='child-tax-code'>
        {!!subItem.eId && 
        <input
            type='hidden'
            name={`elements[${index}].taxes[${subIndex}].eId`}
            value={subItem.eId}
            ref={form.register()}
        />}
        <select
            name={`elements[${index}].taxes[${subIndex}].code`}
            defaultValue={subItem.code}
            onChange={e => {
                const info = taxCodeInfo(e.target.value)
                form.setValue(`elements[${index}].taxes[${subIndex}].rate`, info.rate)
                state.rates[subIndex] = info.rate
                formCalculateTaxes(form, `elements[${index}]`, state, 'rates')

                ratesEnabled[subIndex] = info.variable
                setRatesEnabled([...ratesEnabled])
            }}
            ref={form.register()}
        >
            {taxSelectOptions(subItem.code)}
        </select>
    </td><td className='child-tax-rate'>
        <input
            name={`elements[${index}].taxes[${subIndex}].rate`}
            defaultValue={subItem.rate}
            onChange={e => {
                state.rates[subIndex] = e.target.value
                formCalculateTaxes(form, `elements[${index}]`, state, 'rates')
            }}
            disabled={!ratesEnabled[subIndex]}
            ref={form.register()}
        />
        <label htmlFor={`elements[${index}].taxes[${subIndex}].rate`}>%</label>
    </td><td className='child-space-middle' colSpan={2}>
        &nbsp;
    </td><td className='child-amount'>
        <input
            name={`elements[${index}].taxes[${subIndex}].amount`}
            defaultValue={subItem.amount}
            disabled={true}
            ref={form.register()}
        />
        {formErrors.elements && formErrors.elements[index] &&
            formErrors.elements[index].taxes && formErrors.elements[index].taxes[subIndex] &&
            formErrors.elements[index].taxes[subIndex].amount &&
            <div>{formErrors.elements[index].taxes[subIndex].amount.message}</div>}
    </td></tr>
    )}
    </tbody>
}

export function extractFormValues(t: Transaction): FormData {
    const values: FormData = {
        type: t.type!,
        date: parseISO(t.date!),
        description: t.description,
        actorId: t.actorId!,
        actorTitle: '',
        elements: [],
    }

    if (t.elements) {
        const children = []
        for (let e of t.elements) {
            if (e.drcr == Transaction.Credit) {
                // Only populate credit elements
                if (e.parentId == 0) {
                    values.elements.push({
                        eId: e.id,
                        accountId: e.accountId!,
                        amount: toFormatted(e.amount!, e.currency!),
                        currency: e.currency!,
                        useGross: e.useGross!,
                        grossAmount: toFormatted(e.grossAmount!, e.currency!),
                        description: e.description,
                        taxes: [],
                    })
                }
                else {
                    children.push(e)
                }
            }
        }

        // Now populate child elements. Any orphans are promoted.
        for (let e of children) {
            let orphan = true
            for (let p of values.elements) {
                if (e.parentId == p.eId) {
                    p.taxes!.push({
                        eId: e.id,
                        code: e.taxCode!,
                        rate: taxRate(e.taxCode!),
                        amount: toFormatted(e.amount!, e.currency!),
                    })

                    orphan = false
                    break
                }
            }

            if (orphan) {
                values.elements.push({
                    eId: e.id,
                    accountId: e.accountId!,
                    amount: toFormatted(e.amount!, e.currency!),
                    currency: e.currency!,
                    useGross: e.useGross!,
                    grossAmount: toFormatted(e.grossAmount!, e.currency!),
                    description: e.description,
                })
            }
        }
    }

    return values
}

// Returns true if validation succeeded, false otherwise
export function validateFormData(form: FCV<FormData>, data: FormData) {
    if (!data.actorId) {
        form.setError('actorId', '', 'Customer is required')
        return false
    }
    if (data.actorId == Actor.NewCustomer && !data.actorTitle) {
        form.setError('actorTitle', '', 'Name is required')
        return false
    }
    if (!data.date) {
        form.setError('date', '', 'Date is required')
        return false
    }
    if (!data.elements || data.elements.length == 0) {
        form.setError('submit', '', 'Nothing to save')
        return false
    }
    return validateElementAmounts(form, data) && validateElementTaxAmounts(form, data)
}

// Returns: id of the transaction that was saved/created, 0 otherwise
export async function saveFormData(transaction: Transaction, data: FormData, trx?: TransactionOrKnex): Promise<number> {
    if (data.actorId == Actor.NewCustomer) {
        const actor = Actor.construct({title: data.actorTitle!.trim(), type: Actor.Customer})
        await actor.save(trx)
        data.actorId = actor.id!
    }

    Object.assign(transaction, {
        description: data.description,
        type: data.type,
        date: toDateOnly(data.date),
        actorId: data.actorId,
    })

    // Convert form data to elements
    const elements: IElement[] = []
    data.elements.forEach(e0 => {
        elements.push({
            id: e0.eId ? Number(e0.eId) : undefined,
            accountId: Number(e0.accountId),
            drcr: Transaction.Credit,
            // Note: Use the currency value of the first item
            amount: parseFormatted(e0.amount, data.elements[0].currency),
            currency: data.elements[0].currency,
            useGross: e0.useGross,
            grossAmount: parseFormatted(e0.grossAmount, data.elements[0].currency),
            description: e0.description,
            settleId: 0,
            taxCode: '',
        })

        if (e0.taxes) {
            e0.taxes.forEach(sub => {
                elements.push({
                    id: sub.eId ? Number(sub.eId) : undefined,
                    accountId: Account.Reserved.TaxPayable,
                    drcr: Transaction.Credit,
                    // Note: Use the currency value of the first item
                    amount: parseFormatted(sub.amount, data.elements[0].currency),
                    currency: data.elements[0].currency,
                    useGross: 0,
                    grossAmount: 0,
                    description: '',
                    settleId: 0,
                    taxCode: (sub.code != '' || Number(sub.rate)) ?
                        taxCodeWithRate(sub.code, sub.rate) : '',
                    parentId: -1,
                })
            })
        }
    })

    // Generate balancing elements. Try to re-use IDs if available
    const sums = Transaction.getSums(elements)
    const ids = transaction.getDrElementIds()

    for (let currency in sums) {
        elements.push({
            id: ids.shift(),
            accountId: data.type == Transaction.Sale ? Account.Reserved.Cash : Account.Reserved.AccountsReceivable,
            drcr: Transaction.Debit,
            amount: sums[currency],
            currency: currency,
            useGross: 0,
            grossAmount: 0,
            description: '',
            settleId: 0,
            taxCode: '',
        })
    }

    // If there are any remaining old IDs/elements, zero them out
    for (let id of ids) {
        elements.push({
            id: id,
            drcr: Transaction.Debit,
            amount: 0,
            currency: '',
        })
    }

    // Merge and save.
    await transaction.mergeElements(elements)
    await transaction.save(trx)
    transaction.condenseElements()

    return transaction.id!
}
