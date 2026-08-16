import { LegalLayout, LegalSection } from "./LegalLayout";

export default function Termos() {
  return (
    <LegalLayout title="Termos de Uso" updatedAt="16 de agosto de 2026">
      <p>
        Estes termos regulam o uso do Meu Nino.IA. Ao criar uma conta, você concorda com as regras abaixo.
      </p>

      <LegalSection heading="1. O que o serviço é">
        <p>
          O Meu Nino.IA é uma ferramenta de organização financeira pessoal com um assistente que conversa com você no
          aplicativo e no WhatsApp. O serviço registra e analisa as informações que você fornece.
        </p>
      </LegalSection>

      <LegalSection heading="2. O que o serviço não é">
        <p>
          O Meu Nino.IA não é instituição financeira, não movimenta dinheiro, não abre conta, não concede crédito e não
          presta consultoria de investimentos regulada. As análises, previsões e sugestões são apoio à decisão: a decisão
          e a responsabilidade sobre ela continuam sendo suas.
        </p>
      </LegalSection>

      <LegalSection heading="3. Sua conta">
        <p>
          Você precisa ter 18 anos ou mais, informar dados verdadeiros e manter a senha em sigilo. É você quem responde
          pelas ações realizadas na sua conta. Avise-nos imediatamente em caso de uso não autorizado.
        </p>
      </LegalSection>

      <LegalSection heading="4. Uso aceitável">
        <ul className="list-disc space-y-1 pl-5">
          <li>Não use o serviço para atividade ilícita, fraude ou lavagem de dinheiro.</li>
          <li>Não tente burlar limites técnicos, acessar dados de outras pessoas ou sobrecarregar a plataforma.</li>
          <li>Não envie conteúdo de terceiros sem autorização.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Planos e pagamento">
        <p>
          O Meu Nino.IA pode oferecer planos gratuitos e planos pagos. Quando a assinatura for contratada dentro do
          aplicativo para iPhone ou Android, a cobrança, a renovação e o cancelamento são feitos pela loja de
          aplicativos correspondente, conforme as regras dela, e a gestão da assinatura acontece na sua conta da loja.
          Assinaturas contratadas pelo site são cobradas pelo nosso processador de pagamento. Os preços e o que cada
          plano inclui são exibidos antes da contratação.
        </p>
      </LegalSection>

      <LegalSection heading="6. Cancelamento e arrependimento">
        <p>
          Você pode cancelar a assinatura quando quiser; o acesso pago permanece até o fim do período já pago e não há
          renovação depois disso. Dentro de 7 dias da contratação, você pode exercer o direito de arrependimento previsto
          no Código de Defesa do Consumidor. Quando a compra foi feita por uma loja de aplicativos, o reembolso segue a
          política dessa loja.
        </p>
      </LegalSection>

      <LegalSection heading="7. Exclusão da conta">
        <p>
          Você pode excluir sua conta a qualquer momento em <strong>Perfil → Meus dados</strong>. A exclusão remove seus
          dados pessoais conforme a Política de Privacidade. Antes de excluir, você pode exportar tudo em JSON.
        </p>
      </LegalSection>

      <LegalSection heading="8. Disponibilidade e mudanças">
        <p>
          Podemos alterar, suspender ou encerrar funcionalidades para evolução do produto, manutenção ou segurança.
          Mudanças relevantes serão comunicadas no aplicativo.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitação de responsabilidade">
        <p>
          O serviço é fornecido no estado em que se encontra. Não respondemos por decisões financeiras tomadas com base
          nas análises, por dados incorretos informados por você, nem por indisponibilidade causada por terceiros.
        </p>
      </LegalSection>

      <LegalSection heading="10. Lei aplicável">
        <p>
          Aplica-se a legislação brasileira. Eventuais conflitos serão resolvidos no foro do domicílio do consumidor.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
