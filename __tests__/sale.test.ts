import { Project, Base, Account, Transaction } from '../src/core'
import { extractFormValues, saveFormData, validateFormData } from '../src/components/Sale'
import { MockForm } from '../src/test/MockForm'

const TaxPayable = Account.Reserved.TaxPayable
const Cash = Account.Reserved.Cash

const now = new Date()
const date = now.toISOString().substring(0, 10)

beforeAll(() => {
    return Project.create(':memory:')
})

afterAll(() => {
    Project.knex.destroy()
    return Project.close()
})

test('sale form', async done => {
    expect(validateFormData(MockForm.clear(), {actorId: 0, date: new Date(), elements: [], accountId: Cash}))
        .toBe(false)
    expect(MockForm.errorField).toEqual('actorId')
    expect(MockForm.errorMessage).toEqual('Customer is required')

    // Save a sale using form data
    let t0 = Transaction.construct({})
    let result = await saveFormData(MockForm.clear(), t0, {actorId: 1, date: now, description: 'foo', elements: [
        {accountId: 400, amount: '10', currency: 'USD', useGross: 0, grossAmount: '11', description: 'one', taxes: [
            {description: 'one a', code: ':zero:0', rate: '0', amount: '0'},
            {description: 'one b', code: '', rate: '10', amount: '1'},
            {description: 'one empty', code: '', rate: '', amount: '0'},
        ]},
        {accountId: 400, amount: '', currency: '', useGross: 0, grossAmount: '', description: 'empty'},
        {accountId: 401, amount: '100', currency: '', useGross: 1, grossAmount: '120', description: 'two', taxes: [
            {description: 'two a', code: '::10', rate: '10', amount: '10'},
            {description: 'two b', code: '::10', rate: '10', amount: '10'},
        ]},
    ], accountId: Cash})
    expect(result).toBeTruthy()
    expect(t0.actorId).toBe(1)
    expect(t0.date).toBe(date)
    expect(t0.description).toBe('foo')
    expect(t0.elements!.length).toBe(7)
    expect(t0.elements![0]).toMatchObject({accountId: 400, amount: 1000, currency: 'USD', useGross: 0, grossAmount: 1100, description: 'one'})
    expect(t0.elements![1]).toMatchObject({accountId: 401, amount: 10000, currency: 'USD', useGross: 1, grossAmount: 12000, description: 'two'})
    expect(t0.elements![2]).toMatchObject({accountId: Cash, amount: 13100, currency: 'USD'})
    expect(t0.elements![3]).toMatchObject({accountId: TaxPayable, amount: 0, currency: 'USD', taxCode: ':zero:0', parentId: t0.elements![0].id, description: 'one a'})
    expect(t0.elements![4]).toMatchObject({accountId: TaxPayable, amount: 100, currency: 'USD', taxCode: '::10', parentId: t0.elements![0].id, description: 'one b'})
    expect(t0.elements![5]).toMatchObject({accountId: TaxPayable, amount: 1000, currency: 'USD', taxCode: '::10', parentId: t0.elements![1].id, description: 'two a'})
    expect(t0.elements![6]).toMatchObject({accountId: TaxPayable, amount: 1000, currency: 'USD', taxCode: '::10', parentId: t0.elements![1].id, description: 'two b'})

    // Retrieve it and check
    const t1 = await Transaction.query().findById(result).withGraphFetched('elements')
    expect(t1).toMatchObject(t0)
    expect(t0).toMatchObject(t1)

    // Convert to form data
    let data = extractFormValues(t1)
    expect(data).toMatchObject({actorId: 1, description: 'foo'})
    expect(data.elements.length).toBe(2)
    expect(data.elements[0].taxes!.length).toBe(2)
    expect(data.elements[1].taxes!.length).toBe(2)
    expect(data.elements).toMatchObject([
        {eId: t1.elements![0].id, accountId: 400, amount: '10.00', currency: 'USD', useGross: 0, grossAmount: '11.00', description: 'one', taxes: [
            {eId: t1.elements![3].id, description: 'one a', code: ':zero:0', rate: '0', amount: '0.00'},
            {eId: t1.elements![4].id, description: 'one b', code: '::10', rate: '10', amount: '1.00'},
        ]},
        {eId: t1.elements![1].id, accountId: 401, amount: '100.00', currency: 'USD', useGross: 1, grossAmount: '120.00', description: 'two', taxes: [
            {eId: t1.elements![5].id, description: 'two a', code: '::10', rate: '10', amount: '10.00'},
            {eId: t1.elements![6].id, description: 'two b', code: '::10', rate: '10', amount: '10.00'},
        ]},
    ])

    // Remove tax 'two a', fiddle with 'two b', re-save
    data.elements[1].grossAmount = '110'
    Object.assign(data.elements[1].taxes![0], {code: '', rate: '0.0', amount: '0.0'})
    Object.assign(data.elements[1].taxes![1], {code: '', rate: '0'})

    result = await saveFormData(MockForm.clear(), t1, data)
    expect(result).toBeTruthy()
    expect(t1.elements!.length).toBe(6)
    expect(t1.elements![2]).toMatchObject({accountId: Cash, amount: 12100, currency: 'USD'})
    expect(t1.elements![5]).toMatchObject({accountId: TaxPayable, amount: 1000, currency: 'USD', taxCode: '', parentId: t0.elements![1].id, description: 'two b'})

    // Retrieve and check
    const t2 = await Transaction.query().findById(result).withGraphFetched('elements')
    expect(t2).toMatchObject(t1)
    expect(t1).toMatchObject(t2)

    done()
})