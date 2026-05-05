import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    borderBottom: 1,
    paddingBottom: 10,
  },
  logo: {
    width: 100,
  },
  companyInfo: {
    textAlign: 'right',
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    fontWeight: 'bold',
    color: '#0D6E6E',
  },
  billingSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  table: {
    display: 'flex',
    width: 'auto',
    borderStyle: 'solid',
    borderWidth: 1,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    marginBottom: 20,
  },
  tableRow: {
    margin: 'auto',
    flexDirection: 'row',
  },
  tableColHeader: {
    width: '25%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    backgroundColor: '#f0f0f0',
    padding: 5,
  },
  tableCol: {
    width: '25%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 5,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 10,
    color: 'grey',
    borderTop: 1,
    paddingTop: 10,
  },
});

export const InvoicePDF = ({ invoice }: any) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={{ fontSize: 18, color: '#0D6E6E', fontWeight: 'bold' }}>PeoplePulse</Text>
        <View style={styles.companyInfo}>
          <Text>AutoInc. Botswana</Text>
          <Text>Gaborone, Botswana</Text>
          <Text>TIN: 123456789</Text>
        </View>
      </View>

      <Text style={styles.title}>TAX INVOICE</Text>

      <View style={styles.billingSection}>
        <View>
          <Text style={{ fontWeight: 'bold' }}>Bill To:</Text>
          <Text>{invoice.customerName}</Text>
          <Text>{invoice.customerAddress}</Text>
          <Text>TIN: {invoice.customerTin}</Text>
        </View>
        <View style={{ textAlign: 'right' }}>
          <Text>Invoice #: {invoice.number}</Text>
          <Text>Date: {invoice.date}</Text>
          <Text>Due Date: {invoice.dueDate}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={[styles.tableColHeader, { width: '40%' }]}>
            <Text>Description</Text>
          </View>
          <View style={styles.tableColHeader}>
            <Text>Qty</Text>
          </View>
          <View style={styles.tableColHeader}>
            <Text>Unit Price</Text>
          </View>
          <View style={styles.tableColHeader}>
            <Text>Amount</Text>
          </View>
        </View>
        <View style={styles.tableRow}>
          <View style={[styles.tableCol, { width: '40%' }]}>
            <Text>{invoice.planName} Subscription</Text>
          </View>
          <View style={styles.tableCol}>
            <Text>1</Text>
          </View>
          <View style={styles.tableCol}>
            <Text>P {invoice.amount.toFixed(2)}</Text>
          </View>
          <View style={styles.tableCol}>
            <Text>P {invoice.amount.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      <View style={{ textAlign: 'right' }}>
        <Text>Subtotal: P {invoice.amount.toFixed(2)}</Text>
        <Text>VAT (0%): P 0.00</Text>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginTop: 5 }}>Total: P {invoice.amount.toFixed(2)}</Text>
      </View>

      <View style={styles.footer}>
        <Text>Thank you for your business! Smart HR. Botswana Built.</Text>
        <Text>Contact: support@peoplepulse.bw | +267 123 4567</Text>
      </View>
    </Page>
  </Document>
);
